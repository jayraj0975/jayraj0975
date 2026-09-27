import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkInvariants, extractZipSafely, gitEnv, SAFE_CONFIG, type Dossier } from '@acquicode/engine';
import { config } from '../lib/config';
import { decrypt } from '../lib/crypto';
import { row, withOrg } from '../lib/db';
import { installationToken } from '../lib/github';
import { log, sanitizeError } from '../lib/log';
import { curlResolvePin, resolvePublic } from '../lib/net';
import { blobs, uploadKey } from '../lib/storage';
import { audit } from '../lib/audit';
import { storeDossier } from '../lib/dossiers';

interface ScanRow {
  id: string;
  org_id: string;
  repository_id: string;
  status: string;
  trigger: string;
  ref: string | null;
  created_at: Date;
  provider: 'github' | 'gitlab' | 'upload' | 'cli';
  full_name: string;
  clone_url: string | null;
  external_id: string | null;
  installation_id: string | null;
  credential_enc: string | null;
  enrichment_enabled: boolean;
}

/**
 * Children run in their own process group so a timeout kills everything they
 * started (git spawns git-remote-https, the runner spawns git), leaving no
 * orphans for PID 1 to reap.
 */
function killTree(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Clone with credentials passed through an askpass helper, never on the command line or in git config. */
async function cloneBare(url: string, username: string, password: string, dest: string, workDir: string, extraConfig: string[] = []): Promise<void> {
  const helper = join(workDir, 'askpass.sh');
  await writeFile(helper, '#!/bin/sh\ncase "$1" in\n  Username*) printf "%s" "$ACQ_GIT_USERNAME" ;;\n  *) printf "%s" "$ACQ_GIT_PASSWORD" ;;\nesac\n', { mode: 0o700 });
  await chmod(helper, 0o700);
  const env = { ...gitEnv(), GIT_ASKPASS: helper, ACQ_GIT_USERNAME: username, ACQ_GIT_PASSWORD: password };
  const git = (args: string[], cwd: string, allowFailure = false) =>
    new Promise<void>((resolvePromise, reject) => {
      const child = spawn('git', [...SAFE_CONFIG, '-c', 'credential.helper=', '-c', 'http.followRedirects=false', ...extraConfig.flatMap((x) => ['-c', x]), ...args], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      let stderr = '';
      child.stderr.on('data', (c: Buffer) => {
        if (stderr.length < 4000) stderr += c.toString();
      });
      const timer = setTimeout(() => killTree(child), 15 * 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || allowFailure) resolvePromise();
        else reject(new Error(`git ${args[0]} failed: ${sanitizeError(stderr.trim().split('\n').pop() ?? '')}`));
      });
      child.on('error', reject);
    });
  await git(['clone', '--bare', '--quiet', '--no-local', url, dest], workDir);
  // Attribution notes do not travel with a normal clone; fetch them explicitly.
  await git(['fetch', '--quiet', 'origin', '+refs/notes/*:refs/notes/*'], dest, true);
}

function runAnalysis(input: object, timeoutSeconds: number): Promise<void> {
  const runner = resolve(process.env.ACQUICODE_RUNNER ?? join(process.cwd(), 'dist-node/worker/runner.mjs'));
  const isTs = runner.endsWith('.ts');
  const cmd = isTs ? resolve(process.cwd(), 'node_modules/.bin/tsx') : process.execPath;
  const args = isTs ? [runner] : ['--max-old-space-size=4096', runner];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'], env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production', HOME: process.env.HOME ?? '/tmp' }, detached: true });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 20_000) stderr += c.toString();
    });
    const timer = setTimeout(() => killTree(child), timeoutSeconds * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolvePromise();
      if (signal === 'SIGKILL') return reject(new Error(`analysis exceeded ${timeoutSeconds}s or was killed`));
      let msg = stderr.trim().split('\n').pop() ?? 'analysis failed';
      try {
        const parsed = JSON.parse(msg) as { error: string; violations: string[] | null };
        msg = parsed.violations ? `dossier failed its evidence invariants: ${parsed.violations.slice(0, 3).join('; ')}` : parsed.error;
      } catch {
        /* plain text */
      }
      reject(new Error(sanitizeError(msg)));
    });
    child.on('error', reject);
    child.stdin.end(JSON.stringify(input));
  });
}

/** Process one queued scan end to end. Throws on failure after recording it on the scan. */
export async function processScan(scanId: string, orgId: string): Promise<void> {
  const c = config();
  const scan = await withOrg(orgId, async (tx) => {
    const s = await row<ScanRow>(
      tx,
      `SELECT s.id, s.org_id, s.repository_id, s.status, s.trigger, s.ref, s.created_at, r.provider, r.full_name, r.clone_url, r.external_id,
              r.installation_id::text, r.credential_enc, o.enrichment_enabled
       FROM scans s JOIN repositories r ON r.id = s.repository_id JOIN orgs o ON o.id = s.org_id WHERE s.id = $1`,
      [scanId],
    );
    if (!s || s.status !== 'queued') return null;
    await tx.query("UPDATE scans SET status = 'running', started_at = now() WHERE id = $1", [scanId]);
    return s;
  });
  if (!scan) return;

  await mkdir(c.WORK_DIR, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(resolve(c.WORK_DIR), 'scan-'));
  const started = Date.now();
  try {
    let kind: 'git' | 'directory' = 'git';
    const srcPath = join(work, 'src');
    let forge: { owner: string; repo: string; token: string } | null = null;
    if (scan.provider === 'github') {
      if (!scan.installation_id) throw new Error('repository has no GitHub installation');
      const token = await installationToken(Number(scan.installation_id), scan.external_id ? [Number(scan.external_id)] : undefined);
      await cloneBare(`${c.GITHUB_WEB_URL.replace(/\/+$/, '')}/${scan.full_name}.git`, 'x-access-token', token, srcPath, work);
      const [owner, repo] = scan.full_name.split('/') as [string, string];
      forge = { owner, repo, token };
    } else if (scan.provider === 'gitlab') {
      if (!scan.credential_enc || !scan.clone_url) throw new Error('repository has no GitLab credential');
      // Customer-supplied host: re-check it resolves to a public address and pin the clone to that address.
      const u = new URL(scan.clone_url);
      if (u.protocol !== 'https:' || u.username || u.password) throw new Error('GitLab clone URL must be plain https');
      const port = u.port ? Number(u.port) : 443;
      const { address } = await resolvePublic(u.hostname);
      await cloneBare(scan.clone_url, 'oauth2', decrypt(scan.credential_enc, `repo:${scan.repository_id}`).toString('utf8'), srcPath, work, [curlResolvePin(u.hostname, port, address)]);
    } else if (scan.provider === 'upload') {
      kind = 'directory';
      const zip = await blobs().get(uploadKey(orgId, scanId));
      await mkdir(srcPath, { mode: 0o700 });
      await extractZipSafely(zip, srcPath);
    } else {
      throw new Error('CLI repositories are analysed where the code lives; push a dossier instead');
    }

    const decl = await withOrg(orgId, (tx) => row<{ content: string; id: string }>(tx, 'SELECT id, content FROM declarations WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 1', [scan.repository_id]));
    const output = join(work, 'dossier.json');
    await runAnalysis(
      {
        kind,
        path: srcPath,
        name: scan.full_name,
        ref: scan.ref,
        title: scan.full_name,
        asOf: new Date(scan.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        enrichment: scan.enrichment_enabled,
        declarationsYaml: decl?.content ?? null,
        declarationsSource: decl ? `acquicode workspace declarations ${decl.id}` : '',
        forge,
        output,
      },
      c.SCAN_TIMEOUT_SECONDS,
    );
    const body = await readFile(output);
    const dossier = JSON.parse(body.toString('utf8')) as Dossier;
    const violations = checkInvariants(dossier);
    if (violations.length) throw new Error(`dossier failed its evidence invariants: ${violations.slice(0, 3).join('; ')}`);
    await storeDossier(orgId, scan.repository_id, scanId, dossier, body, 'PLATFORM_ATTESTED');
    log().info({ scanId, orgId, ms: Date.now() - started, readiness: dossier.readiness.level }, 'scan succeeded');
  } catch (err) {
    const message = sanitizeError(err);
    await withOrg(orgId, async (tx) => {
      await tx.query("UPDATE scans SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [scanId, message]);
      await audit(tx, orgId, { type: 'system', id: 'worker' }, 'scan.failed', { type: 'scan', id: scanId }, { error: message });
    });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
    if (scan.provider === 'upload') await blobs().delete(uploadKey(orgId, scanId)).catch(() => undefined);
  }
}

