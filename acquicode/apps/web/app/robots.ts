import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const s = site();
  return {
    // Share links, the app and the API are private by nature and must never be indexed.
    rules: [{ userAgent: '*', allow: ['/', '/sample', '/security', '/verify', '/legal/'], disallow: ['/app', '/api/', '/s/', '/login'] }],
    sitemap: `${s.url}/sitemap.xml`,
  };
}
