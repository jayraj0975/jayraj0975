import { platformKey } from '@/lib/signing';

export const dynamic = 'force-dynamic';

export function GET() {
  const key = platformKey();
  if (!key) return new Response('This deployment has no platform signing key configured.\n', { status: 404, headers: { 'content-type': 'text/plain' } });
  return new Response(key.publicKeyPem, { headers: { 'content-type': 'application/x-pem-file', 'x-acquicode-keyid': key.keyid, 'cache-control': 'public, max-age=3600' } });
}
