import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { resetConfig } from '../lib/config';
import { decrypt, decryptBlob, encrypt, encryptBlob, resetKeys, signState, verifyState } from '../lib/crypto';
import { verifyStripeSignature } from '../lib/billing';
import { verifyGithubSignature } from '../lib/github';
import { isPrivateHost, parseGitlabUrl } from '../lib/gitlab';
import { curlResolvePin, isPublicAddress, resolvePublic } from '../lib/net';
import { assertSameOrigin, formHandler, handler, HttpError, ipFromHeaders } from '../lib/http';
import { sanitizeError } from '../lib/log';
import { planFor } from '../lib/plans';
import { buildDelivery, slackText, urlHint, verifyDelivery, type NotifyPayload } from '../lib/notify';

const k1 = `k1:${randomBytes(32).toString('base64')}`;
const k2 = `k2:${randomBytes(32).toString('base64')}`;

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfig();
  resetKeys();
}

beforeEach(() => {
  setEnv({ NODE_ENV: 'test', APP_URL: 'https://app.example.com', DATA_ENCRYPTION_KEYS: k1, GITHUB_WEBHOOK_SECRET: 'whsec', TRUST_PROXY: undefined, ACQUICODE_DEV_LOGIN: undefined });
});

describe('encryption at rest', () => {
  it('round-trips and binds ciphertext to its context', () => {
    const sealed = encrypt('glpat-secret-token', 'repo:1');
    expect(sealed.startsWith('v1.k1.')).toBe(true);
    expect(sealed).not.toContain('glpat');
    expect(decrypt(sealed, 'repo:1').toString()).toBe('glpat-secret-token');
    expect(() => decrypt(sealed, 'repo:2')).toThrow();
  });

  it('detects tampering', () => {
    const parts = encrypt('hello', 'x').split('.');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0]! ^= 1;
    parts[4] = ct.toString('base64url');
    expect(() => decrypt(parts.join('.'), 'x')).toThrow();
  });

  it('rotates keys: new data uses the first key, old data still decrypts, removed keys fail loudly', () => {
    const old = encrypt('before rotation', 'a');
    const oldBlob = encryptBlob(Buffer.from('blob before'), 'orgs/o/dossiers/s.json');
    setEnv({ DATA_ENCRYPTION_KEYS: `${k2},${k1}` });
    expect(decrypt(old, 'a').toString()).toBe('before rotation');
    expect(decryptBlob(oldBlob, 'orgs/o/dossiers/s.json').toString()).toBe('blob before');
    expect(encrypt('after', 'a').startsWith('v1.k2.')).toBe(true);
    setEnv({ DATA_ENCRYPTION_KEYS: k2 });
    expect(() => decrypt(old, 'a')).toThrow(/no key k1/);
  });

  it('binds blobs to their storage key so they cannot be swapped', () => {
    const blob = encryptBlob(Buffer.from('dossier body'), 'orgs/a/dossiers/1.json');
    expect(blob.subarray(0, 4).toString()).toBe('ACQ1');
    expect(blob.toString('latin1')).not.toContain('dossier body');
    expect(() => decryptBlob(blob, 'orgs/b/dossiers/1.json')).toThrow();
  });

  it('refuses malformed keys', () => {
    setEnv({ DATA_ENCRYPTION_KEYS: 'k1:c2hvcnQ=' });
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });
});

describe('signed OAuth state', () => {
  it('accepts its own state, rejects tampering and expiry', () => {
    const s = signState({ u: 'user-1' });
    expect(verifyState<{ u: string }>(s)?.u).toBe('user-1');
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'admin', exp: 9e9, n: 'x' })).toString('base64url');
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.${sig}x`)).toBeNull();
    expect(verifyState(signState({ u: 'x' }, -1))).toBeNull();
    expect(verifyState(null)).toBeNull();
    expect(verifyState('garbage')).toBeNull();
  });
});

describe('webhook signatures', () => {
  it('verifies Stripe signatures with a replay window', () => {
    const payload = '{"id":"evt_1"}';
    const t = 1_800_000_000;
    const v1 = createHmac('sha256', 'stripe-secret').update(`${t}.${payload}`).digest('hex');
    expect(verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'stripe-secret', t + 10)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'other-secret', t + 10)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'stripe-secret', t + 301)).toBe(false);
    expect(verifyStripeSignature(`${payload} `, `t=${t},v1=${v1}`, 'stripe-secret', t)).toBe(false);
    expect(verifyStripeSignature(payload, null, 'stripe-secret', t)).toBe(false);
  });

  it('verifies GitHub signatures and fails closed without a secret', () => {
    const body = Buffer.from('{"zen":"x"}');
    const good = `sha256=${createHmac('sha256', 'whsec').update(body).digest('hex')}`;
    expect(verifyGithubSignature(body, good)).toBe(true);
    expect(verifyGithubSignature(body, good.replace(/.$/, '0'))).toBe(false);
    expect(verifyGithubSignature(body, null)).toBe(false);
    setEnv({ GITHUB_WEBHOOK_SECRET: undefined });
    expect(verifyGithubSignature(body, good)).toBe(false);
  });
});

describe('SSRF guards for customer-supplied hosts', () => {
  it('classifies addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2002:a00:1::1', '224.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });

  it('rejects internal names and literal addresses, including encoded forms', () => {
    for (const url of ['https://localhost/g/p', 'https://127.0.0.1/g/p', 'https://2130706433/g/p', 'https://0x7f.1/g/p', 'https://[::1]/g/p', 'https://[::ffff:7f00:1]/g/p', 'https://gitlab/g/p', 'https://git.corp.internal/g/p', 'https://169.254.169.254/g/p']) {
      expect(() => parseGitlabUrl(url), url).toThrow(HttpError);
    }
    expect(() => parseGitlabUrl('http://gitlab.com/g/p')).toThrow(/https/);
    expect(() => parseGitlabUrl('https://user:pw@gitlab.com/g/p')).toThrow(/credentials/);
    expect(() => parseGitlabUrl('https://gitlab.com/justone')).toThrow(/path/);
    expect(parseGitlabUrl('https://gitlab.example.com:8443/group/sub/project.git/-/tree/main')).toEqual({ host: 'gitlab.example.com:8443', hostname: 'gitlab.example.com', port: 8443, path: 'group/sub/project' });
    expect(isPrivateHost('gitlab.com')).toBe(false);
  });

  it('refuses to resolve to non-public addresses', async () => {
    await expect(resolvePublic('localhost')).rejects.toThrow(/not allowed/);
    await expect(resolvePublic('10.0.0.1')).rejects.toThrow(/not allowed/);
    await expect(resolvePublic('[::1]')).rejects.toThrow(/not allowed/);
    await expect(resolvePublic('8.8.8.8')).resolves.toEqual({ address: '8.8.8.8', family: 4 });
  });

  it('pins git to the checked address', () => {
    expect(curlResolvePin('gitlab.example.com', 443, '203.0.113.9')).toBe('http.curloptResolve=gitlab.example.com:443:203.0.113.9');
    expect(curlResolvePin('gitlab.example.com', 443, '2606:4700::1')).toBe('http.curloptResolve=gitlab.example.com:443:[2606:4700::1]');
  });
});

describe('client addresses behind proxies', () => {
  const h = (xff: string) => new Headers({ 'x-forwarded-for': xff });
  it('ignores forwarding headers unless a proxy is trusted', () => {
    expect(ipFromHeaders(h('1.2.3.4'), 0)).toBe('unknown');
  });
  it('takes the entry the trusted proxy added, not the spoofable leftmost one', () => {
    expect(ipFromHeaders(h('6.6.6.6, 1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(ipFromHeaders(h('6.6.6.6, 1.2.3.4, 10.0.0.2'), 2)).toBe('1.2.3.4');
    expect(ipFromHeaders(h('1.2.3.4'), 2)).toBe('unknown');
    expect(ipFromHeaders(h('<script>'), 1)).toBe('unknown');
    expect(ipFromHeaders(new Headers(), 1)).toBe('unknown');
  });
});

describe('request handling', () => {
  it('refuses cross-origin mutations', () => {
    const req = (headers: Record<string, string>) => new Request('https://app.example.com/api/x', { method: 'POST', headers });
    expect(() => assertSameOrigin(req({ origin: 'https://evil.example' }))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req({ origin: 'https://app.example.com' }))).not.toThrow();
  });

  it('sends form errors back to a same-origin page only', async () => {
    const fail = formHandler(async (_req: Request) => {
      throw new HttpError(400, 'Name is required');
    });
    const own = await fail(new Request('https://app.example.com/api/x', { method: 'POST', headers: { referer: 'https://app.example.com/app/settings?notice=old' } }));
    expect(own.status).toBe(303);
    expect(own.headers.get('location')).toBe('https://app.example.com/app/settings?error=Name%20is%20required');
    const foreign = await fail(new Request('https://app.example.com/api/x', { method: 'POST', headers: { referer: 'https://evil.example/phish' } }));
    expect(foreign.headers.get('location')).toBe('https://app.example.com/app?error=Name%20is%20required');
    const unauth = formHandler(async (_req: Request) => {
      throw new HttpError(401, 'Sign in');
    });
    expect((await unauth(new Request('https://app.example.com/api/x', { method: 'POST' }))).headers.get('location')).toBe('https://app.example.com/login');
  });

  it('hides internal errors and gives API responses a deny-all CSP unless the route set one', async () => {
    const boom = handler(async () => {
      throw new Error('connection to postgres://admin:hunter2@db failed');
    });
    const res = await boom();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    const own = handler(async () => new Response('<p>x</p>', { headers: { 'content-security-policy': "default-src 'none'; sandbox" } }));
    expect((await own()).headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });
});

describe('log hygiene', () => {
  it('redacts credentials from error messages before they are stored or logged', () => {
    const msg = sanitizeError(
      new Error(
        [
          'clone https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r failed',
          'token ' + 'gh' + 'p_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab',
          'glpat-abcdefghijklmnopqrst',
          'acq_supersecretapitokenvalue',
          'AKIA' + 'IOSFODNN7EXAMPLF',
          'Authorization: Bearer abc.def.ghi',
          'private-token: glpat-xyz',
        ].join(' '),
      ),
    );
    for (const leaked of ['ghs_abcdefghijklmnop', 'ghp_ABCDEFGHIJKLMNOP', 'glpat-abcdefghijk', 'supersecretapitoken', 'IOSFODNN7EXAMPLF', 'abc.def.ghi', 'glpat-xyz']) {
      expect(msg, leaked).not.toContain(leaked);
    }
  });
});

describe('configuration', () => {
  it('refuses unsafe production settings', async () => {
    const { config } = await import('../lib/config');
    setEnv({ NODE_ENV: 'production', DATA_ENCRYPTION_KEYS: undefined });
    expect(() => config()).toThrow(/DATA_ENCRYPTION_KEYS/);
    setEnv({ NODE_ENV: 'production', DATA_ENCRYPTION_KEYS: k1, ACQUICODE_DEV_LOGIN: '1' });
    expect(() => config()).toThrow(/DEV_LOGIN/);
    setEnv({ NODE_ENV: 'production', DATA_ENCRYPTION_KEYS: k1, ACQUICODE_DEV_LOGIN: '0', APP_URL: 'http://app.example.com' });
    expect(() => config()).toThrow(/https/);
    setEnv({ NODE_ENV: 'production', DATA_ENCRYPTION_KEYS: k1, APP_URL: 'http://127.0.0.1:3000' });
    expect(() => config()).not.toThrow();
  });

  it('falls back to the free plan for unknown plan ids', () => {
    expect(planFor('does-not-exist').id).toBe('free');
  });
});

describe('notifications', () => {
  const payload: NotifyPayload = {
    event: 'dossier.changed',
    id: '00000000-0000-4000-8000-000000000001',
    occurredAt: '2026-09-28T00:00:00.000Z',
    organisation: { id: 'o', name: 'Acme' },
    message: 'api <prod>: 2 material changes & readiness REVIEW → BLOCKED.',
    url: 'https://app.example.com/app/scans/1',
    changes: { material: 2, readinessFrom: 'REVIEW', readinessTo: 'BLOCKED', highlights: ['New finding SEC-001 <script>'] },
  };

  it('signs JSON deliveries so receivers can verify them', () => {
    const now = 1_800_000_000_000;
    const d = buildDelivery({ url: 'https://hooks.example.com/x', format: 'json', secret: 'whsec_abc' }, payload, now);
    expect(JSON.parse(d.body)).toMatchObject({ event: 'dossier.changed', changes: { material: 2 } });
    expect(d.headers['x-acquicode-event']).toBe('dossier.changed');
    expect(verifyDelivery(d.body, d.headers['x-acquicode-signature']!, 'whsec_abc', now / 1000)).toBe(true);
    expect(verifyDelivery(d.body, d.headers['x-acquicode-signature']!, 'wrong', now / 1000)).toBe(false);
    expect(verifyDelivery(`${d.body} `, d.headers['x-acquicode-signature']!, 'whsec_abc', now / 1000)).toBe(false);
    expect(verifyDelivery(d.body, d.headers['x-acquicode-signature']!, 'whsec_abc', now / 1000 + 301)).toBe(false);
  });

  it('formats Slack messages with escaping', () => {
    const text = slackText(payload);
    expect(text).toContain('&lt;prod&gt;');
    expect(text).toContain('&amp; readiness');
    expect(text).toContain('• New finding SEC-001 &lt;script&gt;');
    expect(text).toContain('<https://app.example.com/app/scans/1|Open in AcquiCode>');
    const d = buildDelivery({ url: 'https://hooks.slack.com/services/T1/B2/secret', format: 'slack', secret: 's' }, payload);
    expect(Object.keys(JSON.parse(d.body))).toEqual(['text']);
  });

  it('never displays a webhook URL in full', () => {
    expect(urlHint('https://hooks.slack.com/services/T000/B000/XXXXSECRET')).toBe('hooks.slack.com/services/…');
    expect(urlHint('https://example.com/')).toBe('example.com/…');
  });
});
