/**
 * Re-encrypt everything held at rest with the current (first) key in
 * DATA_ENCRYPTION_KEYS, so an old key can be removed afterwards:
 *
 *   DATA_ENCRYPTION_KEYS="knew:...,kold:..." node dist-node/worker/reencrypt.mjs
 *
 * Covers GitLab credentials, dossier bodies and pending uploads. Idempotent:
 * anything already under the current key is left untouched. Prints counts
 * only; never prints keys, credentials or content.
 */
import { q, withOrg } from '../lib/db';
import { currentKeyId, decrypt, encrypt, sealedKeyId } from '../lib/crypto';
import { blobs } from '../lib/storage';

export interface ReencryptReport {
  currentKey: string;
  credentials: { checked: number; reencrypted: number };
  blobs: { checked: number; reencrypted: number; missing: number };
}

export async function reencryptAll(): Promise<ReencryptReport> {
  const kid = currentKeyId();
  const report: ReencryptReport = { currentKey: kid, credentials: { checked: 0, reencrypted: 0 }, blobs: { checked: 0, reencrypted: 0, missing: 0 } };
  const store = blobs();
  const orgs = await q<{ id: string }>('SELECT id FROM orgs ORDER BY id');
  for (const org of orgs) {
    const { creds, keys } = await withOrg(org.id, async (c) => ({
      creds: (await c.query<{ id: string; credential_enc: string }>('SELECT id, credential_enc FROM repositories WHERE credential_enc IS NOT NULL')).rows,
      keys: [
        ...(await c.query<{ k: string }>('SELECT storage_key AS k FROM dossiers')).rows.map((r) => r.k),
        ...(await c.query<{ k: string }>("SELECT upload_key AS k FROM scans WHERE upload_key IS NOT NULL AND status IN ('queued', 'running')")).rows.map((r) => r.k),
      ],
    }));
    for (const r of creds) {
      report.credentials.checked++;
      if (sealedKeyId(r.credential_enc) === kid) continue;
      const aad = `repo:${r.id}`;
      const resealed = encrypt(decrypt(r.credential_enc, aad), aad);
      await withOrg(org.id, (c) => c.query('UPDATE repositories SET credential_enc = $2 WHERE id = $1 AND credential_enc = $3', [r.id, resealed, r.credential_enc]));
      report.credentials.reencrypted++;
    }
    for (const key of keys) {
      report.blobs.checked++;
      let raw: Buffer;
      try {
        raw = await store.getRaw(key);
      } catch {
        report.blobs.missing++; // removed by retention or an upload already consumed
        continue;
      }
      if (sealedKeyId(raw) === kid) continue;
      await store.put(key, await store.get(key));
      report.blobs.reencrypted++;
    }
  }
  return report;
}

const isMain = process.argv[1] && /reencrypt\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  reencryptAll().then(
    (r) => {
      process.stdout.write(`${JSON.stringify(r)}\n`);
      process.exit(0);
    },
    (err: Error) => {
      process.stderr.write(`re-encryption failed: ${err.message.replace(/v1\.[^\s]+/g, '[ciphertext]')}\n`);
      process.exit(1);
    },
  );
}
