import { platformPublicKeys } from '@/lib/signing';

export const dynamic = 'force-dynamic';

/** Every key this deployment has signed platform-attested dossiers with, current and retired. */
export function GET() {
  const keys = platformPublicKeys().map((k) => ({ keyid: k.keyid, status: k.status, algorithm: 'ed25519', publicKeyPem: k.publicKeyPem }));
  return Response.json({ keys }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
