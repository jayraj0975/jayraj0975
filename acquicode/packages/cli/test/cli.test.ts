import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildMeridian } from '../../engine/test/fixtures/meridian/build.js';

const MAIN = resolve(__dirname, '../src/main.ts');
const TSX = resolve(__dirname, '../node_modules/.bin/tsx');
let work: string;
let repo: string;

function cli(args: string[]) {
  const r = spawnSync(TSX, [MAIN, ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'acq-cli-'));
  repo = buildMeridian(join(work, 'meridian')).dir;
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('acquicode CLI', () => {
  it('prints help', () => {
    const r = cli(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Evidence-graded technical diligence/);
  });

  it('scans, signs, gates CI and writes every artifact', () => {
    expect(cli(['keygen', '--out', 'keys']).code).toBe(0);
    const r = cli(['scan', repo, '--out', 'out', '--sign-key', 'keys/acquicode-signing.key.pem', '--fail-on', 'blocked']);
    expect(r.code).toBe(2); // Meridian is BLOCKED
    expect(r.out).toMatch(/^BLOCKED/);
    for (const f of ['dossier.json', 'dossier.html', 'sbom.cdx.json', 'dossier.dsse.json']) expect(existsSync(join(work, 'out', f))).toBe(true);
  });

  it('verifies the signature and reproduces the digest from the repository', () => {
    const r = cli(['verify', 'out/dossier.json', '--envelope', 'out/dossier.dsse.json', '--key', 'keys/acquicode-signing.pub.pem', '--reproduce', repo]);
    expect(r.out).toMatch(/signature: valid/);
    expect(r.out).toMatch(/MATCHES/);
    expect(r.code).toBe(0);
  });

  it('fails verification for a tampered dossier', () => {
    const d = JSON.parse(readFileSync(join(work, 'out/dossier.json'), 'utf8'));
    d.readiness.level = 'READY';
    writeFileSync(join(work, 'tampered.json'), JSON.stringify(d));
    const r = cli(['verify', 'tampered.json', '--envelope', 'out/dossier.dsse.json', '--key', 'keys/acquicode-signing.pub.pem']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/dossier matches signed digest: NO/);
  });

  it('diffs an earlier snapshot against the current one', () => {
    const earlier = execFileSync('git', ['rev-list', '--max-count=1', 'HEAD~5'], { cwd: repo }).toString().trim();
    expect(cli(['scan', repo, '--ref', earlier, '--out', 'old']).code).toBe(0);
    const r = cli(['scan', repo, '--out', 'new', '--previous', 'old/dossier.json']);
    expect(r.code).toBe(0);
    const diff = JSON.parse(readFileSync(join(work, 'new/diff.json'), 'utf8'));
    expect(diff.counts.material).toBeGreaterThan(0);
    expect(readFileSync(join(work, 'new/dossier.html'), 'utf8')).toMatch(/Changes Since the Previous Snapshot/);
  });

  it('rejects bad input clearly', () => {
    expect(cli(['scan', 'does-not-exist']).err).toMatch(/not a directory/);
    expect(cli(['frobnicate']).code).toBe(1);
    expect(cli(['push', 'out/dossier.json', '--server', 'http://example.com', '--token', 't']).err).toMatch(/plain HTTP/);
  });
});
