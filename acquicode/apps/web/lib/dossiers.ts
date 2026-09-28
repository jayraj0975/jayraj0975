import { buildStatement, diffDossiers, signStatement, type Dossier } from '@acquicode/engine';
import { config } from './config';
import { row, rows, withOrg } from './db';
import { log, sanitizeError } from './log';
import { platformKey } from './signing';
import { blobs, dossierKey } from './storage';
import { audit } from './audit';
import { appLink, emit } from './notify';

/**
 * Store a dossier, sign it when a platform key is configured, record what
 * changed since the previous snapshot, and mark the scan succeeded.
 */
export async function storeDossier(orgId: string, repositoryId: string, scanId: string, dossier: Dossier, body: Buffer, level: 'PLATFORM_ATTESTED' | 'SELF_ATTESTED', envelopeIn: object | null = null, signerKeyid: string | null = null): Promise<void> {
  const { dossierDigest, toCycloneDx } = await import('@acquicode/engine');
  const digest = dossierDigest(dossier);
  let envelope = envelopeIn;
  let keyid = signerKeyid;
  const key = level === 'PLATFORM_ATTESTED' ? platformKey() : null;
  if (key) {
    const { createHash } = await import('node:crypto');
    const sbom = JSON.stringify(toCycloneDx(dossier));
    envelope = signStatement(
      buildStatement(dossier, {
        level: 'PLATFORM_ATTESTED',
        producer: `${new URL(config().APP_URL).host} hosted runner`,
        artifacts: [
          { name: 'dossier.json', sha256: createHash('sha256').update(body).digest('hex') },
          { name: 'sbom.cdx.json', sha256: createHash('sha256').update(sbom).digest('hex') },
        ],
      }),
      key.privateKeyPem,
    );
    keyid = key.keyid;
  }
  await blobs().put(dossierKey(orgId, scanId), body);
  await withOrg(orgId, async (tx) => {
    const prev = await row<{ id: string }>(
      tx,
      "SELECT id FROM scans WHERE repository_id = $1 AND status = 'succeeded' AND id <> $2 ORDER BY finished_at DESC LIMIT 1",
      [repositoryId, scanId],
    );
    await tx.query('INSERT INTO dossiers (scan_id, org_id, storage_key, envelope, digest, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)', [scanId, orgId, dossierKey(orgId, scanId), envelope ? JSON.stringify(envelope) : null, digest, body.length]);
    let change: { material: number; readinessFrom: string | null; highlights: string[] } | null = null;
    if (prev) {
      try {
        const prevDossier = JSON.parse((await blobs().get(dossierKey(orgId, prev.id))).toString('utf8')) as Dossier;
        const diff = diffDossiers(prevDossier, dossier);
        const material = diff.events.filter((e) => e.severity === 'material');
        change = { material: material.length, readinessFrom: prevDossier.readiness.level, highlights: material.slice(0, 3).map((e) => e.summary.slice(0, 200)) };
        for (const e of diff.events.slice(0, 200)) {
          await tx.query('INSERT INTO change_events (org_id, repository_id, scan_id, previous_scan_id, kind, severity, summary) VALUES ($1, $2, $3, $4, $5, $6, $7)', [orgId, repositoryId, scanId, prev.id, e.kind, e.severity, e.summary.slice(0, 1000)]);
        }
      } catch (err) {
        // The previous dossier may have been purged by retention; the new snapshot still stands.
        log().warn({ scanId, err: sanitizeError(err) }, 'could not diff against previous snapshot');
      }
    }
    const counts = { ...dossier.summary.counts, unknownsMaterial: dossier.unknowns.filter((u) => u.material).length };
    await tx.query(
      "UPDATE scans SET status = 'succeeded', finished_at = now(), readiness = $2, counts = $3, digest = $4, commit_sha = $5, attestation = $6, signer_keyid = $7, error = NULL WHERE id = $1",
      [scanId, dossier.readiness.level, JSON.stringify(counts), digest, dossier.subjects[0]?.headCommit ?? null, envelope ? level : null, keyid],
    );
    await audit(tx, orgId, { type: 'system', id: 'worker' }, 'scan.succeeded', { type: 'scan', id: scanId }, { readiness: dossier.readiness.level, digest });
    const repo = await row<{ full_name: string }>(tx, 'SELECT full_name FROM repositories WHERE id = $1', [repositoryId]);
    const org = await row<{ name: string }>(tx, 'SELECT name FROM orgs WHERE id = $1', [orgId]);
    const base = {
      organisation: { id: orgId, name: org?.name ?? '' },
      repository: { id: repositoryId, name: repo?.full_name ?? '' },
      scan: { id: scanId, readiness: dossier.readiness.level },
      url: appLink(`/app/scans/${scanId}`),
    };
    await emit(tx, orgId, 'scan.completed', { ...base, message: `${base.repository.name}: ${dossier.readiness.level}. ${dossier.summary.headline}` });
    if (change && (change.material > 0 || change.readinessFrom !== dossier.readiness.level)) {
      const moved = change.readinessFrom !== dossier.readiness.level ? ` Readiness ${change.readinessFrom} → ${dossier.readiness.level}.` : '';
      await emit(tx, orgId, 'dossier.changed', {
        ...base,
        message: `${base.repository.name}: ${change.material} material change${change.material === 1 ? '' : 's'} since the previous snapshot.${moved}`,
        changes: { material: change.material, readinessFrom: change.readinessFrom, readinessTo: dossier.readiness.level, highlights: change.highlights },
      });
    }
  });
}

export async function loadDossier(orgId: string, scanId: string): Promise<{ dossier: Dossier; envelope: object | null; digest: string } | null> {
  const meta = await withOrg(orgId, (tx) => row<{ storage_key: string; envelope: object | null; digest: string }>(tx, 'SELECT storage_key, envelope, digest FROM dossiers WHERE scan_id = $1', [scanId]));
  if (!meta) return null;
  const body = await blobs().get(meta.storage_key);
  return { dossier: JSON.parse(body.toString('utf8')) as Dossier, envelope: meta.envelope, digest: meta.digest };
}

/** Retention: delete dossier bodies older than the organisation's retention period; keep the digest ledger. */
export async function purgeExpired(orgId: string): Promise<number> {
  return withOrg(orgId, async (tx) => {
    const old = await rows<{ scan_id: string; storage_key: string }>(
      tx,
      `SELECT d.scan_id, d.storage_key FROM dossiers d JOIN orgs o ON o.id = d.org_id
       WHERE d.created_at < now() - make_interval(days => o.retention_days)`,
    );
    for (const o of old) {
      await blobs().delete(o.storage_key);
      await tx.query('DELETE FROM dossiers WHERE scan_id = $1', [o.scan_id]);
    }
    if (old.length) await audit(tx, orgId, { type: 'system', id: 'retention' }, 'retention.purged', null, { dossiers: old.length });
    return old.length;
  });
}
