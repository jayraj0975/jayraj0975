/**
 * End-to-end: a fresh database, the production Next.js build and the worker,
 * driven over HTTP. Requires PostgreSQL (TEST_DATABASE_ADMIN_URL, a superuser)
 * and `pnpm build` to have run. Skips with a message otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { zipSync, strToU8 } from 'fflate';
import { migrate } from '../scripts/migrate';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = resolve(__dirname, '..');
const GH_PORT = PORT + 1000;
const GH = `http://127.0.0.1:${GH_PORT}`;
const appKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SERVER = join(WEB, '.next/standalone/apps/web/server.js');
const built = existsSync(SERVER) && existsSync(join(WEB, 'dist-node/worker/index.mjs'));

let dbAvailable = false;
try {
  const c = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  await c.connect();
  await c.end();
  dbAvailable = true;
} catch {
  dbAvailable = false;
}
const ready = built && dbAvailable;
if (!ready) console.warn(`e2e skipped: ${built ? '' : 'run pnpm build first; '}${dbAvailable ? '' : `no PostgreSQL at ${ADMIN_URL}`}`);

const dbName = `acquicode_e2e_${randomBytes(4).toString('hex')}`;
const ownerUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${dbName}`);
const appUrl = ownerUrl.replace(/\/\/[^@]+@/, '//acquicode_app:app_password@');
const tmp = mkdtempSync(join(tmpdir(), 'acq-e2e-'));
const procs: ChildProcess[] = [];
let owner: pg.Client;
const logs = { web: '', worker: '' };
const platform = generateKeyPairSync('ed25519');
const platformPem = platform.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  APP_URL: BASE,
  DATABASE_URL: appUrl,
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  PLATFORM_SIGNING_KEY: platformPem,
  STORAGE_DIR: join(tmp, 'blobs'),
  WORK_DIR: join(tmp, 'work'),
  GITHUB_WEBHOOK_SECRET: 'gh-webhook-secret',
  GITHUB_APP_ID: '4242',
  GITHUB_APP_SLUG: 'acquicode-test',
  GITHUB_APP_PRIVATE_KEY: appKey,
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'client-secret',
  GITHUB_API_URL: GH,
  GITHUB_WEB_URL: GH,
  STRIPE_SECRET_KEY: 'sk_test_unused',
  STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret',
  ACQUICODE_RUNNER: join(WEB, 'dist-node/worker/runner.mjs'),
  LOG_LEVEL: 'warn',
  PORT: String(PORT),
  HOSTNAME: '127.0.0.1',
};

interface Actor {
  userId: string;
  orgId: string;
  cookie: string;
}

async function actor(login: string, plan = 'readiness'): Promise<Actor> {
  const u = await owner.query<{ id: string }>('INSERT INTO users (github_id, login, name) VALUES ($1, $2, $2) RETURNING id', [Math.floor(Math.random() * 1e9), login]);
  const o = await owner.query<{ id: string }>('INSERT INTO orgs (name, plan) VALUES ($1, $2) RETURNING id', [`${login} org`, plan]);
  await owner.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')", [o.rows[0]!.id, u.rows[0]!.id]);
  const token = `sess_${randomBytes(24).toString('base64url')}`;
  await owner.query("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')", [createHash('sha256').update(token).digest('hex'), u.rows[0]!.id]);
  return { userId: u.rows[0]!.id, orgId: o.rows[0]!.id, cookie: `acq_session=${token}` };
}

async function http(path: string, init: RequestInit & { as?: Actor; origin?: string | null } = {}) {
  const headers = new Headers(init.headers);
  if (init.as) headers.set('cookie', init.as.cookie);
  if (init.origin !== null && init.method && init.method !== 'GET') headers.set('origin', init.origin ?? BASE);
  return fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
}

async function waitFor<T>(fn: () => Promise<T | null>, ms: number, label: string): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}\n--- worker output ---\n${logs.worker.slice(-4000)}\n--- web output ---\n${logs.web.slice(-4000)}`);
}

function repoZip(): Uint8Array {
  return zipSync({
    'demo-main/package.json': strToU8(JSON.stringify({ name: 'demo', license: 'UNLICENSED', dependencies: { left: '^1.0.0' } })),
    'demo-main/src/index.ts': strToU8('export const a = 1;\nconst key = "AKIA' + 'E2EFIXTUREKEY001";\n'),
    'demo-main/README.md': strToU8('# demo\n'),
  });
}


/**
 * A stand-in for github.com and api.github.com: OAuth code exchange, the user
 * APIs and the App installation APIs, with fixed accounts:
 *   code "alice"    → GitHub user 1001, can access installation 555
 *   code "bob"      → GitHub user 2002, can access installation 666
 *   code "bob-555"  → GitHub user 2002, can access installations 555 and 666
 *   code "carol"    → GitHub user 3003 (login carol)
 *   code "impostor" → GitHub user 4004 (login carol: the username changed hands)
 */
const ACCOUNTS: Record<string, { id: number; login: string; installations: number[] }> = {
  alice: { id: 1001, login: 'alice', installations: [555] },
  bob: { id: 2002, login: 'bob', installations: [666] },
  'bob-555': { id: 2002, login: 'bob', installations: [555, 666] },
  carol: { id: 3003, login: 'carol', installations: [] },
  impostor: { id: 4004, login: 'carol', installations: [] },
};
let fakeGithub: Server;
function startFakeGithub(): Promise<void> {
  fakeGithub = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', GH);
      const auth = req.headers.authorization ?? '';
      const who = auth.startsWith('Bearer user-') ? ACCOUNTS[auth.slice('Bearer user-'.length)] : undefined;
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const p = url.pathname;
      if (req.method === 'POST' && p === '/login/oauth/access_token') {
        const code = (JSON.parse(body || '{}') as { code?: string }).code ?? '';
        return ACCOUNTS[code] ? json(200, { access_token: `user-${code}` }) : json(200, { error: 'bad_verification_code' });
      }
      if (p === '/user' && who) return json(200, { id: who.id, login: who.login, name: who.login, email: `${who.login}@example.com` });
      if (p === '/user/emails' && who) return json(200, []);
      if (p === '/user/installations' && who) return json(200, { total_count: who.installations.length, installations: who.installations.map((id) => ({ id })) });
      const user = /^\/users\/([^/]+)$/.exec(p);
      if (user) {
        const acct = Object.values(ACCOUNTS).find((a) => a.login === user[1] && a.id !== 4004);
        return acct ? json(200, { id: acct.id, login: acct.login, type: 'User' }) : json(404, { message: 'Not Found' });
      }
      const inst = /^\/app\/installations\/(\d+)(\/access_tokens)?$/.exec(p);
      if (inst && auth.startsWith('Bearer ey')) {
        if (inst[2]) return json(201, { token: `inst-${inst[1]}`, expires_at: new Date(Date.now() + 3600e3).toISOString() });
        return json(200, { id: Number(inst[1]), account: { login: inst[1] === '555' ? 'acme' : 'mallory-co', type: 'Organization' }, suspended_at: null });
      }
      if (p === '/installation/repositories' && auth.startsWith('Bearer inst-')) {
        const id = auth.slice('Bearer inst-'.length);
        const owner = id === '555' ? 'acme' : 'mallory-co';
        return json(200, { repositories: [{ id: Number(id) * 10, full_name: `${owner}/api`, default_branch: 'main', clone_url: `${GH}/${owner}/api.git`, private: true, archived: false }] });
      }
      json(404, { message: 'Not Found' });
    });
  });
  return new Promise((ok) => fakeGithub.listen(GH_PORT, '127.0.0.1', () => ok()));
}

beforeAll(async () => {
  if (!ready) return;
  await startFakeGithub();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'acquicode_app'");
  if (!role.rowCount) await admin.query("CREATE ROLE acquicode_app LOGIN PASSWORD 'app_password' NOSUPERUSER NOBYPASSRLS");
  await admin.end();
  await migrate(ownerUrl, 'acquicode_app', join(WEB, 'db/migrations'));
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  // The production artefact: Next.js standalone output, as the Docker image runs it.
  const web = spawn(process.execPath, [SERVER], { cwd: join(WEB, '.next/standalone/apps/web'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const worker = spawn(process.execPath, [join(WEB, 'dist-node/worker/index.mjs')], { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(web, worker);
  for (const [name, p] of [['web', web], ['worker', worker]] as const) {
    p.stdout!.on('data', (c: Buffer) => (logs[name] += c.toString()));
    p.stderr!.on('data', (c: Buffer) => (logs[name] += c.toString()));
  }
  await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok ?? null, 60_000, 'web server');
}, 120_000);

afterAll(async () => {
  for (const p of procs) p.kill('SIGTERM');
  fakeGithub?.close();
  await owner?.end();
  if (ready) {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!ready)('AcquiCode end to end', () => {
  let alice: Actor;
  let bob: Actor;
  let scanId = '';

  it('serves public pages with security headers', async () => {
    const res = await http('/');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(await res.text()).toMatch(/Know what a buyer will find/);
    expect((await http('/api/ready')).status).toBe(200);
    const sample = await http('/sample');
    expect(sample.status).toBe(200);
    const html = await sample.text();
    expect(html).toMatch(/Demo data: synthetic company/);
    expect(html).toMatch(/BLOCKED/);
    const key = await http('/.well-known/acquicode-signing-key.pem');
    expect(await key.text()).toMatch(/BEGIN PUBLIC KEY/);
  }, 120_000);

  it('redirects signed-out visitors and rejects unauthenticated API calls', async () => {
    expect((await http('/app')).headers.get('location')).toMatch(/\/login/);
    expect((await http('/api/scans/00000000-0000-4000-8000-000000000000/download/json')).status).toBe(401);
  });

  it('refuses cross-origin form posts', async () => {
    alice = await actor('alice');
    bob = await actor('bob');
    const res = await http('/api/settings', { method: 'POST', as: alice, origin: 'https://evil.example', body: new URLSearchParams({ name: 'pwned', retention_days: '30' }) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/error=Cross-origin/);
    const org = await owner.query('SELECT name FROM orgs WHERE id = $1', [alice.orgId]);
    expect(org.rows[0].name).toBe('alice org');
  });

  it('analyses an uploaded archive in the worker and signs the dossier', async () => {
    const fd = new FormData();
    fd.set('name', 'demo');
    fd.set('archive', new Blob([new Uint8Array(repoZip())], { type: 'application/zip' }), 'demo.zip');
    const res = await http('/api/uploads', { method: 'POST', as: alice, body: fd });
    expect(res.status).toBe(303);
    const loc = res.headers.get('location')!;
    expect(loc).toMatch(/\/app\/scans\//);
    scanId = loc.split('/').pop()!;
    const done = await waitFor(async () => {
      const r = await owner.query('SELECT status, readiness, attestation, error FROM scans WHERE id = $1', [scanId]);
      return r.rows[0]?.status === 'succeeded' || r.rows[0]?.status === 'failed' ? r.rows[0] : null;
    }, 90_000, 'scan');
    expect(done.error).toBeNull();
    expect(done.status).toBe('succeeded');
    expect(done.readiness).toBe('BLOCKED'); // provider-format key in the archive
    expect(done.attestation).toBe('PLATFORM_ATTESTED');
    // The upload was deleted and nothing is left in the work directory.
    expect(existsSync(join(tmp, 'blobs', 'orgs', alice.orgId, 'uploads', `${scanId}.zip`))).toBe(false);
    expect(existsSync(join(tmp, 'work')) ? readdirSync(join(tmp, 'work')) : []).toEqual([]);
    const page = await http(`/app/scans/${scanId}`, { as: alice });
    const html = await page.text();
    expect(html).toMatch(/BLOCKED/);
    expect(html).not.toContain('AKIA' + 'E2EFIXTUREKEY001');
    expect(html).toMatch(/not whether the software is good, secure or free of legal risk/);
  }, 120_000);

  it('stores dossiers encrypted at rest', async () => {
    const dir = join(tmp, 'blobs', 'orgs', alice.orgId, 'dossiers');
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(join(dir, files[0]!));
    expect(raw.subarray(0, 4).toString()).toBe('ACQ1');
    expect(raw.toString('latin1')).not.toMatch(/acquicode\.dossier\/1/);
  });

  it('offers every export and verifies the platform signature', async () => {
    const json = await http(`/api/scans/${scanId}/download/json`, { as: alice });
    expect(json.headers.get('content-disposition')).toMatch(/attachment/);
    expect(json.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    const dossierText = await json.text();
    expect(JSON.parse(dossierText).schema).toBe('acquicode.dossier/1');
    const html = await http(`/api/scans/${scanId}/download/html`, { as: alice });
    expect(html.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect((await http(`/api/scans/${scanId}/download/sbom`, { as: alice })).status).toBe(200);
    const env = await http(`/api/scans/${scanId}/download/envelope`, { as: alice });
    const envText = await env.text();
    const fd = new FormData();
    fd.set('dossier', new Blob([dossierText]), 'dossier.json');
    fd.set('envelope', new Blob([envText]), 'dossier.dsse.json');
    const v = await http('/api/verify', { method: 'POST', body: fd, origin: null });
    const r = JSON.parse(Buffer.from(new URL(v.headers.get('location')!).searchParams.get('r')!, 'base64url').toString());
    expect(r).toMatchObject({ signatureValid: true, dossierMatches: true, level: 'PLATFORM_ATTESTED' });
    const tampered = JSON.parse(dossierText);
    tampered.readiness.level = 'READY';
    const fd2 = new FormData();
    fd2.set('dossier', new Blob([JSON.stringify(tampered)]), 'dossier.json');
    fd2.set('envelope', new Blob([envText]), 'dossier.dsse.json');
    const v2 = await http('/api/verify', { method: 'POST', body: fd2, origin: null });
    const r2 = JSON.parse(Buffer.from(new URL(v2.headers.get('location')!).searchParams.get('r')!, 'base64url').toString());
    expect(r2.dossierMatches).toBe(false);
  });

  it('isolates tenants: another organisation cannot see or download the dossier', async () => {
    expect((await http(`/app/scans/${scanId}`, { as: bob })).status).toBe(404);
    expect((await http(`/api/scans/${scanId}/download/json`, { as: bob })).status).toBe(404);
    const bobRepos = await http('/app', { as: bob });
    expect(await bobRepos.text()).not.toMatch(/demo/);
    const del = await http(`/api/repos/${(await owner.query('SELECT repository_id FROM scans WHERE id = $1', [scanId])).rows[0].repository_id}/delete`, { method: 'POST', as: bob, body: new URLSearchParams({ confirm: 'demo' }) });
    expect(del.headers.get('location')).toMatch(/error=Not%20found/);
  });

  it('shares a read-only link, counts views, and revokes it', async () => {
    const res = await http(`/api/scans/${scanId}/share`, { method: 'POST', as: alice, body: new URLSearchParams({ label: 'Buyer counsel', days: '7' }) });
    const token = new URL(res.headers.get('location')!, BASE).searchParams.get('share')!;
    expect(token).toMatch(/^shr_/);
    const view = await http(`/s/${token}`);
    expect(view.status).toBe(200);
    expect(await view.text()).toMatch(/Buyer counsel/);
    expect((await http(`/api/s/${token}/download/json`)).status).toBe(200);
    const link = await owner.query('SELECT id, views FROM share_links WHERE scan_id = $1', [scanId]);
    expect(link.rows[0].views).toBe(2);
    await http(`/api/share/${link.rows[0].id}/revoke`, { method: 'POST', as: alice });
    expect(await (await http(`/s/${token}`)).text()).toMatch(/not available/);
    expect((await http(`/api/s/${token}/download/json`)).status).toBe(404);
    expect(await (await http('/s/shr_forged_token_that_does_not_exist_1234')).text()).toMatch(/not available/);
  });

  it('versions declarations and rejects invalid ones', async () => {
    const repoId = (await owner.query('SELECT repository_id FROM scans WHERE id = $1', [scanId])).rows[0].repository_id;
    const bad = await http(`/api/repos/${repoId}/declarations`, { method: 'POST', as: alice, body: new URLSearchParams({ content: 'distribution: everywhere' }) });
    expect(bad.headers.get('location')).toMatch(/error=Not%20saved/);
    const good = await http(`/api/repos/${repoId}/declarations`, { method: 'POST', as: alice, body: new URLSearchParams({ content: 'distribution: saas\nai_usage: none\n' }) });
    expect(good.headers.get('location')).toMatch(/notice=/);
    await http(`/api/repos/${repoId}/declarations`, { method: 'POST', as: alice, body: new URLSearchParams({ content: 'distribution: on_prem\n' }) });
    const versions = await owner.query('SELECT count(*)::int AS n FROM declarations WHERE repository_id = $1', [repoId]);
    expect(versions.rows[0].n).toBe(2);
  });

  it('accepts a signed dossier pushed from the CLI with an API token', async () => {
    const created = await http('/api/tokens/create', { method: 'POST', as: alice, body: new URLSearchParams({ name: 'ci', days: '30' }) });
    const token = new URL(created.headers.get('location')!, BASE).searchParams.get('token')!;
    expect(token).toMatch(/^acq_/);
    const engine = await import('@acquicode/engine');
    const dossier = JSON.parse(await (await http(`/api/scans/${scanId}/download/json`, { as: alice })).text());
    dossier.subjects[0].name = 'laptop/demo';
    dossier.title = 'laptop/demo';
    const key = engine.generateSigningKey();
    const envelope = engine.signStatement(engine.buildStatement(dossier, { level: 'SELF_ATTESTED', producer: 'test' }), key.privateKey);
    const push = await fetch(`${BASE}/api/v1/dossiers`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ dossier, envelope, publicKey: key.publicKey }) });
    expect(push.status).toBe(201);
    const body = await push.json();
    const row = await owner.query('SELECT attestation, signer_keyid, trigger FROM scans WHERE id = $1', [body.scan]);
    expect(row.rows[0]).toMatchObject({ attestation: 'SELF_ATTESTED', signer_keyid: key.keyid, trigger: 'cli' });
    const forged = await fetch(`${BASE}/api/v1/dossiers`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ dossier: { ...dossier, readiness: { level: 'READY', reasons: [] } }, envelope, publicKey: key.publicKey }) });
    expect(forged.status).toBe(422);
    expect((await fetch(`${BASE}/api/v1/dossiers`, { method: 'POST', headers: { authorization: 'Bearer acq_wrongwrongwrongwrongwrong', 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  it('rejects unsigned webhooks', async () => {
    const body = JSON.stringify({ installation: { id: 1 } });
    expect((await fetch(`${BASE}/api/github/webhook`, { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=deadbeef', 'x-github-event': 'push' } })).status).toBe(401);
    const good = `sha256=${createHmac('sha256', 'gh-webhook-secret').update(body).digest('hex')}`;
    expect((await fetch(`${BASE}/api/github/webhook`, { method: 'POST', body, headers: { 'x-hub-signature-256': good, 'x-github-event': 'ping', 'x-github-delivery': 'd1' } })).status).toBe(200);
    expect((await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=00' } })).status).toBe(400);
  });

  it('connects a GitHub installation only after GitHub confirms the signed-in user can access it', async () => {
    await owner.query('UPDATE users SET github_id = 1001 WHERE id = $1', [alice.userId]);
    await owner.query('UPDATE users SET github_id = 2002 WHERE id = $1', [bob.userId]);
    const installState = async (who: Actor) => new URL((await http('/api/github/install', { method: 'POST', as: who })).headers.get('location')!).searchParams.get('state')!;
    const setup = async (who: Actor, installation: number) => {
      const r = await http(`/api/github/setup?installation_id=${installation}&setup_action=install&state=${encodeURIComponent(await installState(who))}`, { as: who });
      const loc = new URL(r.headers.get('location')!);
      expect(`${loc.origin}${loc.pathname}`).toBe(`${GH}/login/oauth/authorize`);
      return loc.searchParams.get('state')!;
    };
    const callback = async (who: Actor, verify: string, code: string) =>
      decodeURIComponent((await http(`/api/auth/github/callback?code=${code}&state=${encodeURIComponent(verify)}`, { as: who })).headers.get('location') ?? '');

    // Another organisation's admin replays alice's installation id: GitHub does not list it for them.
    expect(await callback(bob, await setup(bob, 555), 'bob')).toMatch(/does not list that installation/);
    // Their session, but authorising as a different GitHub account.
    expect(await callback(bob, await setup(bob, 555), 'alice')).toMatch(/not the account you are signed in with/);
    // A state issued to one session cannot be completed by another.
    expect(await callback(bob, await setup(alice, 555), 'bob-555')).toMatch(/another session/);
    // The legitimate path.
    expect(await callback(alice, await setup(alice, 555), 'alice')).toMatch(/Connected acme: 1 repository added/);
    // Genuine GitHub access is still not enough once the installation belongs to another organisation.
    expect(await callback(bob, await setup(bob, 555), 'bob-555')).toMatch(/already connected to another AcquiCode organisation/);

    const repos = await owner.query("SELECT org_id, full_name, installation_id::int AS inst FROM repositories WHERE provider = 'github'");
    expect(repos.rows).toEqual([{ org_id: alice.orgId, full_name: 'acme/api', inst: 555 }]);
    expect((await owner.query('SELECT org_id FROM github_installations')).rows).toEqual([{ org_id: alice.orgId }]);
  });

  it('binds invitations to the GitHub account, not the username', async () => {
    const inv = await http('/api/members/invite', { method: 'POST', as: alice, body: new URLSearchParams({ login: 'carol', role: 'member' }) });
    expect(decodeURIComponent(inv.headers.get('location')!)).toMatch(/carol will join as member/);
    const signIn = async (code: string) => {
      const start = await http('/api/auth/github/start', { method: 'POST' });
      const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      const cb = await fetch(`${BASE}/api/auth/github/callback?code=${code}&state=${encodeURIComponent(state)}`, { headers: { cookie }, redirect: 'manual' });
      expect(cb.headers.get('location')).toMatch(/\/app$/);
      const r = await owner.query<{ orgs: string[] }>('SELECT array_agg(m.org_id::text) AS orgs FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.github_id = $1', [ACCOUNTS[code]!.id]);
      return r.rows[0]!.orgs;
    };
    // Someone who now holds the username "carol" signs in first: they get their own workspace only.
    expect(await signIn('impostor')).not.toContain(alice.orgId);
    // The account that was invited joins.
    expect(await signIn('carol')).toContain(alice.orgId);
  });

  it('records an append-only audit trail', async () => {
    const r = await owner.query('SELECT action FROM audit_events WHERE org_id = $1 ORDER BY id', [alice.orgId]);
    const actions = r.rows.map((x: { action: string }) => x.action);
    for (const a of ['upload.received', 'scan.succeeded', 'dossier.downloaded', 'share_link.created', 'share_link.viewed', 'share_link.revoked', 'declarations.saved', 'api_token.created', 'dossier.pushed', 'github.installation_connected', 'member.invited']) expect(actions).toContain(a);
  });

  it('deletes a repository and its encrypted dossiers', async () => {
    const repo = await owner.query("SELECT r.id, r.full_name FROM repositories r JOIN scans s ON s.repository_id = r.id WHERE s.id = $1", [scanId]);
    const res = await http(`/api/repos/${repo.rows[0].id}/delete`, { method: 'POST', as: alice, body: new URLSearchParams({ confirm: repo.rows[0].full_name }) });
    expect(res.headers.get('location')).toMatch(/notice=Deleted/);
    expect((await owner.query('SELECT 1 FROM scans WHERE id = $1', [scanId])).rowCount).toBe(0);
    expect(existsSync(join(tmp, 'blobs', 'orgs', alice.orgId, 'dossiers', `${scanId}.json`))).toBe(false);
  });
});
