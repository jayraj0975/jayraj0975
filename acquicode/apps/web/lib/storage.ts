import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { config } from './config';
import { decryptBlob, encryptBlob } from './crypto';

/**
 * Object storage for dossier bodies and uploaded archives. Everything is
 * encrypted before it leaves the process (AES-256-GCM, key id in the header),
 * with the object key bound as associated data so blobs cannot be swapped.
 */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** The stored (encrypted) bytes, for key rotation. */
  getRaw(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]{0,300}$/;

function checkKey(key: string): void {
  if (!KEY.test(key) || key.includes('..')) throw new Error('invalid storage key');
}

class FsStore implements BlobStore {
  constructor(private readonly root: string) {}
  private path(key: string): string {
    checkKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(resolve(this.root) + sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, encryptBlob(data, key), { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer> {
    return decryptBlob(await readFile(this.path(key)), key);
  }
  async getRaw(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

class S3Store implements BlobStore {
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client> | null = null;
  constructor(private readonly bucket: string) {}
  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-s3').then(({ S3Client }) => {
        const c = config();
        return new S3Client({
          region: c.S3_REGION,
          ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT } : {}),
          forcePathStyle: c.S3_FORCE_PATH_STYLE === 'true',
        });
      });
    }
    return this.clientPromise;
  }
  async put(key: string, data: Buffer): Promise<void> {
    checkKey(key);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const sse = config().S3_SERVER_SIDE_ENCRYPTION;
    await (await this.client()).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: encryptBlob(data, key), ...(sse === 'off' ? {} : { ServerSideEncryption: sse }) }));
  }
  async get(key: string): Promise<Buffer> {
    return decryptBlob(await this.getRaw(key), key);
  }
  async getRaw(key: string): Promise<Buffer> {
    checkKey(key);
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await (await this.client()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    checkKey(key);
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let store: BlobStore | null = null;

export function blobs(): BlobStore {
  if (store) return store;
  const c = config();
  store = c.STORAGE_DRIVER === 's3' ? new S3Store(c.S3_BUCKET!) : new FsStore(resolve(c.STORAGE_DIR));
  return store;
}

let storageCheck: { at: number; ok: boolean } | null = null;

/**
 * Round trip through blob storage (write, read back, delete) with the real
 * encryption. Cached for a minute per process, so the public readiness
 * endpoint cannot be used to generate storage traffic.
 */
export async function storageReady(): Promise<boolean> {
  if (storageCheck && Date.now() - storageCheck.at < 60_000) return storageCheck.ok;
  const key = 'health/readiness-check';
  const probe = Buffer.from(`ready ${Date.now()}`);
  let ok = false;
  try {
    await blobs().put(key, probe);
    ok = (await blobs().get(key)).equals(probe);
    await blobs().delete(key);
  } catch {
    ok = false;
  }
  storageCheck = { at: Date.now(), ok };
  return ok;
}

export function dossierKey(orgId: string, scanId: string): string {
  return `orgs/${orgId}/dossiers/${scanId}.json`;
}

export function uploadKey(orgId: string, scanId: string): string {
  return `orgs/${orgId}/uploads/${scanId}.zip`;
}
