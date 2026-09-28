import { isUuid, withOrg } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { loadDossier } from '@/lib/dossiers';
import { downloadResponse } from '@/lib/downloads';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) => {
  const { id, kind } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApiContext('viewer');
  const loaded = await loadDossier(ctx.org.id, id);
  if (!loaded) throw new HttpError(404, 'No dossier for this scan (not finished, failed, or removed by retention)');
  await withOrg(ctx.org.id, (c) => audit(c, ctx.org.id, { type: 'user', id: ctx.user.id }, 'dossier.downloaded', { type: 'scan', id }, { kind }));
  void req;
  return downloadResponse(kind, loaded.dossier, loaded.envelope, { filename: loaded.dossier.title });
});
