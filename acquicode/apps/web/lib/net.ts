import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { HttpError } from './errors';

/**
 * Outbound requests to hosts a customer typed in (self-managed GitLab) must
 * never reach internal addresses. Names are resolved, every address is
 * checked, and the connection is pinned to a checked address so a DNS answer
 * cannot change between the check and the connect (rebinding).
 */
const blocked = new BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, 'ipv4');
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched by the IPv4 rules above; do not add ::ffff:0:0/96,
// which BlockList would apply to every IPv4 address.
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, 'ipv6');

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  return !blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/** Names that must never be resolved, whatever DNS says. */
export function isInternalName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.home.arpa') || !h.includes('.');
}

/** Resolve a hostname and return one address, refusing if any address is not public. */
export async function resolvePublic(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    if (!isPublicAddress(bare)) throw new HttpError(400, 'That host is not allowed');
    return { address: bare, family: isIP(bare) as 4 | 6 };
  }
  if (isInternalName(bare)) throw new HttpError(400, 'That host is not allowed');
  const addrs = await new Promise<Array<{ address: string; family: number }>>((ok, fail) =>
    dnsLookup(bare, { all: true, verbatim: true }, (err, a) => (err ? fail(new HttpError(400, `Could not resolve ${bare}`)) : ok(a))),
  );
  if (!addrs.length) throw new HttpError(400, `Could not resolve ${bare}`);
  if (addrs.some((a) => !isPublicAddress(a.address))) throw new HttpError(400, 'That host resolves to a non-public address');
  return { address: addrs[0]!.address, family: addrs[0]!.family as 4 | 6 };
}

/** A lookup that only ever returns the pre-checked address. */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
}

/** GET a JSON document over https from a customer-supplied host, pinned to a public address. No redirects. */
export async function getPublicJson(url: string, headers: Record<string, string>, timeoutMs = 15_000, maxBytes = 1_000_000): Promise<{ status: number; body: unknown }> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new HttpError(400, 'Only https is allowed');
  const { address, family } = await resolvePublic(u.hostname);
  return new Promise((ok, fail) => {
    const req = request(
      { host: u.hostname, servername: isIP(u.hostname) ? undefined : u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`, method: 'GET', headers, lookup: pinnedLookup(address, family), timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) req.destroy(new HttpError(502, 'Response too large'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          ok({ status: res.statusCode ?? 0, body });
        });
        res.on('error', fail);
      },
    );
    req.on('timeout', () => req.destroy(new HttpError(504, 'Upstream timed out')));
    req.on('error', fail);
    req.end();
  });
}

/** git/curl argument pinning a host to a checked address for one clone. */
export function curlResolvePin(hostname: string, port: number, address: string): string {
  return `http.curloptResolve=${hostname}:${port}:${isIP(address) === 6 ? `[${address}]` : address}`;
}
