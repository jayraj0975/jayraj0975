#!/usr/bin/env node
// Post-deploy check against a running instance. No credentials needed.
//   node deploy/smoke.mjs https://acquicode.example.com
// Exercises the server, the database connection and migrations, the analysis
// engine and git inside the image (the sample dossier is built on demand), and
// the security headers. Exits non-zero on the first failure.
const base = (process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const get = (path) => fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });

await check('health', async () => assert((await get('/api/health')).ok, 'not ok'));
await check('database reachable and migrated', async () => {
  const r = await get('/api/ready');
  const body = await r.json();
  assert(r.ok && body.status === 'ready', JSON.stringify(body));
  assert(body.migrations >= 3, `only ${body.migrations} migrations applied`);
});
await check('security headers', async () => {
  const r = await get('/');
  assert(r.status === 200, `status ${r.status}`);
  const csp = r.headers.get('content-security-policy') ?? '';
  assert(/script-src 'self' 'nonce-/.test(csp) && /frame-ancestors 'none'/.test(csp), `CSP: ${csp}`);
  assert(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
  if (base.startsWith('https://')) assert((r.headers.get('strict-transport-security') ?? '').includes('max-age'), 'HSTS missing');
});
await check('analysis engine and git in the image (sample dossier)', async () => {
  const r = await get('/api/sample/download/json');
  assert(r.ok, `status ${r.status}`);
  const d = await r.json();
  assert(d.schema === 'acquicode.dossier/1', `schema ${d.schema}`);
  assert(d.readiness.level === 'BLOCKED', `sample readiness ${d.readiness.level}`);
  assert(r.headers.get('content-security-policy')?.includes("default-src 'none'"), 'download CSP missing');
});
await check('signed-out users are sent to sign in', async () => {
  const r = await get('/app');
  assert([302, 303, 307].includes(r.status) && /\/login/.test(r.headers.get('location') ?? ''), `status ${r.status}`);
});
await check('platform signing key published (or deliberately absent)', async () => {
  const r = await get('/.well-known/acquicode-signing-key.pem');
  if (r.status === 404) return console.log('     (no PLATFORM_SIGNING_KEY: hosted dossiers will be unsigned)');
  assert(r.ok && (await r.text()).includes('BEGIN PUBLIC KEY'), `status ${r.status}`);
});

if (failed) {
  console.log(`${failed} check(s) failed against ${base}`);
  process.exit(1);
}
console.log(`all checks passed against ${base}`);
