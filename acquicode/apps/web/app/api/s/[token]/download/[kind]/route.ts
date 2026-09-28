import { resolveShare } from '@/lib/share';
import { clientIp, handler, HttpError } from '@/lib/http';
import { downloadResponse } from '@/lib/downloads';
import { rateLimitIp } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: Promise<{ token: string; kind: string }> }) => {
  const { token, kind } = await params;
  await rateLimitIp('share', clientIp(req), 120, 600);
  const shared = await resolveShare(token, clientIp(req), `download:${kind}`);
  if (!shared) throw new HttpError(404, 'This link has expired, was revoked, or never existed');
  return downloadResponse(kind, shared.dossier, shared.envelope, { filename: shared.dossier.title });
});
