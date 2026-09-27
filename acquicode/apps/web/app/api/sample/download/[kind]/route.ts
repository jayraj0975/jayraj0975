import { handler } from '@/lib/http';
import { sampleDossier } from '@/lib/sample';
import { downloadResponse } from '@/lib/downloads';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ kind: string }> }) => {
  const { kind } = await params;
  return downloadResponse(kind, await sampleDossier(), null, { filename: 'meridian-demo', banner: 'Demo data: synthetic company' });
});
