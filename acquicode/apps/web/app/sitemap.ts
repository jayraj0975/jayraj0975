import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const { url } = site();
  return ['', '/sample', '/security', '/verify', '/legal/terms', '/legal/privacy', '/legal/subprocessors'].map((p) => ({ url: `${url}${p}`, changeFrequency: 'monthly', priority: p === '' ? 1 : 0.6 }));
}
