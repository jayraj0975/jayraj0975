import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config';

interface Key {
  kid: string;
  key: Buffer;
}

let keys: Key[] | null = null;

function loadKeys(): Key[] {
  if (keys) return keys;
  const raw = config().DATA_ENCRYPTION_KEYS;
  if (!raw) {
    // Development and tests only: config() refuses to start production without real keys.
    // A fixed, public development key lets the web process and the worker share data locally.
    keys = [{ kid: 'dev-insecure', key: createHash('sha256').update('acquicode development key: not secret').digest() }];
    return keys;
  }
  keys = raw.split(',').map((part) => {
    const [kid, b64] = part.trim().split(':');
    if (!kid || !b64) throw new Error('DATA_ENCRYPTION_KEYS entries must be kid:base64key');
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error(`encryption key ${kid} must be 32 bytes`);
    return { kid, key };
  });
  return keys;
}

/** AES-256-GCM. Output: "v1.<kid>.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encrypt(plain: Buffer | string, aad = ''): string {
  const { kid, key } = loadKeys()[0]!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain), cipher.final()]);
  return ['v1', kid, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(sealed: string, aad = ''): Buffer {
  const [v, kid, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !kid || !iv || !tag || ct === undefined) throw new Error('unrecognised ciphertext');
  const k = loadKeys().find((x) => x.kid === kid);
  if (!k) throw new Error(`no key ${kid} to decrypt (was it rotated out?)`);
  const decipher = createDecipheriv('aes-256-gcm', k.key, Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
}

/** Binary-safe variant for blobs: header + raw bytes, avoiding base64 inflation. */
export function encryptBlob(plain: Buffer, aad: string): Buffer {
  const { kid, key } = loadKeys()[0]!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const kidBuf = Buffer.from(kid, 'utf8');
  if (kidBuf.length > 255) throw new Error('key id too long');
  return Buffer.concat([Buffer.from('ACQ1'), Buffer.from([kidBuf.length]), kidBuf, iv, cipher.getAuthTag(), ct]);
}

export function decryptBlob(sealed: Buffer, aad: string): Buffer {
  if (sealed.subarray(0, 4).toString() !== 'ACQ1') throw new Error('unrecognised blob format');
  const kidLen = sealed[4]!;
  const kid = sealed.subarray(5, 5 + kidLen).toString('utf8');
  const iv = sealed.subarray(5 + kidLen, 17 + kidLen);
  const tag = sealed.subarray(17 + kidLen, 33 + kidLen);
  const ct = sealed.subarray(33 + kidLen);
  const k = loadKeys().find((x) => x.kid === kid);
  if (!k) throw new Error(`no key ${kid} to decrypt blob`);
  const decipher = createDecipheriv('aes-256-gcm', k.key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

/** Tokens are stored only as SHA-256 hashes. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hmacSha256Hex(secret: string, body: Buffer | string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Signed, expiring state for OAuth and installation redirects. */
export function signState(payload: Record<string, string | number>, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${body}.${createHmac('sha256', stateKey()).update(body).digest('base64url')}`;
}

export function verifyState<T extends Record<string, unknown>>(state: string | null): T | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateKey()).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

function stateKey(): Buffer {
  return createHash('sha256').update('acquicode-state:').update(loadKeys()[0]!.key).digest();
}

/**
 * A newly created secret (API token, share link, request token) is shown to its creator once.
 * It travels to the page encrypted, bound to that user and valid for a few minutes, so it never
 * appears in plaintext in URLs, browser history or proxy logs.
 */
export function sealReveal(value: string, userId: string, ttlSeconds = 600): string {
  return encrypt(JSON.stringify({ v: value, u: userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }), 'reveal');
}

export function openReveal(sealed: string | string[] | undefined, userId: string): string | null {
  if (typeof sealed !== 'string' || sealed.length > 2000) return null;
  try {
    const d = JSON.parse(decrypt(sealed, 'reveal').toString('utf8')) as { v: string; u: string; exp: number };
    return d.u === userId && d.exp > Date.now() / 1000 && typeof d.v === 'string' ? d.v : null;
  } catch {
    return null;
  }
}

/** Key id that new data is encrypted with. */
export function currentKeyId(): string {
  return loadKeys()[0]!.kid;
}

/** Key id a sealed value or blob was encrypted with, without decrypting it. */
export function sealedKeyId(sealed: string | Buffer): string | null {
  if (typeof sealed === 'string') return sealed.startsWith('v1.') ? (sealed.split('.')[1] ?? null) : null;
  if (sealed.subarray(0, 4).toString() !== 'ACQ1') return null;
  return sealed.subarray(5, 5 + sealed[4]!).toString('utf8');
}

/** Test hook. */
export function resetKeys(): void {
  keys = null;
}
