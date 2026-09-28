import type { Dossier } from '@acquicode/engine';
import { hashToken } from './crypto';
import { q1, withOrg } from './db';
import { audit } from './audit';
import { loadDossier } from './dossiers';

/** Resolve a share token to its dossier, counting and auditing the view. */
export async function resolveShare(token: string, ip: string, action: string): Promise<{ dossier: Dossier; envelope: object | null; label: string; expiresAt: Date; orgName: string; attestation: string | null; createdAt: Date } | null> {
  if (!/^shr_[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const link = await q1<{ org_id: string; link_id: string; scan_id: string }>('SELECT * FROM resolve_share_link($1)', [hashToken(token)]);
  if (!link) return null;
  const meta = await withOrg(link.org_id, async (c) => {
    const r = await c.query<{ label: string; expires_at: Date; attestation: string | null; created_at: Date }>(
      'UPDATE share_links l SET views = views + 1, last_viewed_at = now() FROM scans s WHERE l.id = $1 AND s.id = l.scan_id RETURNING l.label, l.expires_at, s.attestation, s.created_at',
      [link.link_id],
    );
    await audit(c, link.org_id, { type: 'share_link', id: link.link_id }, `share_link.${action}`, { type: 'scan', id: link.scan_id }, {}, ip);
    return r.rows[0] ?? null;
  });
  if (!meta) return null;
  const org = await q1<{ name: string }>('SELECT name FROM orgs WHERE id = $1', [link.org_id]);
  const loaded = await loadDossier(link.org_id, link.scan_id);
  if (!loaded) return null;
  return { dossier: loaded.dossier, envelope: loaded.envelope, label: meta.label, expiresAt: meta.expires_at, orgName: org?.name ?? '', attestation: meta.attestation, createdAt: meta.created_at };
}
