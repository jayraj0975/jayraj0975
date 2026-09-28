import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** RFC 9116. Served only when a security contact is known for this deployment. */
export function GET() {
  const s = site();
  if (!s.securityEmail) return new Response('No security contact is configured for this deployment.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const body = [
    `Contact: mailto:${s.securityEmail}`,
    `Expires: ${expires}`,
    `Canonical: ${s.url}/.well-known/security.txt`,
    `Policy: ${s.url}/security`,
    'Preferred-Languages: en',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}
