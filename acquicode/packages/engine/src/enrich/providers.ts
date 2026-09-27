import { cvss3BaseScore, severityFromScore } from './cvss.js';
import type {
  EnrichmentCache,
  ForgeProvider,
  PackageRef,
  PullRequestReview,
  RegistryMetadata,
  RegistryProvider,
  Severity,
  VulnerabilityProvider,
  VulnRecord,
} from './types.js';
import { nameKey, pkgKey } from './types.js';

type Fetch = typeof fetch;

async function getJson(fetchImpl: Fetch, url: string, init: RequestInit = {}, timeoutMs = 20_000, maxBytes = 25 * 1024 * 1024): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'acquicode-engine', ...(init.headers ?? {}) } });
    if (res.status === 404) return { __notFound: true };
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > maxBytes) throw new Error(`${url} response too large`);
    const text = await res.text();
    if (text.length > maxBytes) throw new Error(`${url} response too large`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

/** OSV.dev: POST /v1/querybatch, then GET /v1/vulns/{id} for details. */
export class OsvProvider implements VulnerabilityProvider {
  readonly name = 'osv.dev';
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly base = 'https://api.osv.dev',
  ) {}

  async query(pkgs: PackageRef[]): Promise<Map<string, VulnRecord[]>> {
    const result = new Map<string, VulnRecord[]>();
    const ids = new Map<string, Set<string>>();
    for (let i = 0; i < pkgs.length; i += 500) {
      const batch = pkgs.slice(i, i + 500);
      const body = { queries: batch.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) };
      const res = (await getJson(this.fetchImpl, `${this.base}/v1/querybatch`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })) as {
        results?: Array<{ vulns?: Array<{ id: string }> }>;
      } | null;
      batch.forEach((p, j) => {
        const vulns = res?.results?.[j]?.vulns ?? [];
        ids.set(pkgKey(p), new Set(vulns.map((v) => v.id)));
      });
    }
    const allIds = [...new Set([...ids.values()].flatMap((s) => [...s]))].sort();
    const details = new Map<string, VulnRecord>();
    await pool(allIds, 8, async (id) => {
      const v = (await getJson(this.fetchImpl, `${this.base}/v1/vulns/${encodeURIComponent(id)}`)) as Record<string, unknown> | null;
      if (v && !('__notFound' in v)) details.set(id, normalizeOsv(v));
    });
    for (const p of pkgs) {
      const set = ids.get(pkgKey(p)) ?? new Set();
      result.set(pkgKey(p), [...set].sort().map((id) => details.get(id) ?? { id, aliases: [], summary: '', severity: 'unknown' as Severity, cvssScore: null, malicious: id.startsWith('MAL-'), fixedIn: [], url: `https://osv.dev/vulnerability/${id}`, modified: '' }));
    }
    return result;
  }
}

export function normalizeOsv(v: Record<string, unknown>): VulnRecord {
  const id = String(v.id ?? '');
  let score: number | null = null;
  for (const s of Array.isArray(v.severity) ? (v.severity as Array<{ type?: string; score?: string }>) : []) {
    if (s.type === 'CVSS_V3' && s.score) score = cvss3BaseScore(s.score) ?? score;
  }
  const dbSev = String(((v.database_specific ?? {}) as Record<string, unknown>).severity ?? '').toLowerCase();
  let severity: Severity = score !== null ? severityFromScore(score) : 'unknown';
  if (severity === 'unknown' && ['critical', 'high', 'medium', 'moderate', 'low'].includes(dbSev)) severity = (dbSev === 'moderate' ? 'medium' : dbSev) as Severity;
  const fixed = new Set<string>();
  for (const a of Array.isArray(v.affected) ? (v.affected as Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>) : []) {
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixed.add(e.fixed);
  }
  return {
    id,
    aliases: (Array.isArray(v.aliases) ? (v.aliases as string[]) : []).slice(0, 10).sort(),
    summary: String(v.summary ?? v.details ?? '').slice(0, 300),
    severity,
    cvssScore: score,
    malicious: id.startsWith('MAL-'),
    fixedIn: [...fixed].sort().slice(0, 10),
    url: `https://osv.dev/vulnerability/${id}`,
    modified: String(v.modified ?? ''),
  };
}

/** Public package registries: npm and PyPI metadata (license, latest release, maintainers). */
export class PublicRegistryProvider implements RegistryProvider {
  readonly name = 'registry.npmjs.org+pypi.org';
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async lookup(pkgs: Array<{ ecosystem: string; name: string }>): Promise<Map<string, RegistryMetadata>> {
    const out = new Map<string, RegistryMetadata>();
    const unique = [...new Map(pkgs.filter((p) => p.ecosystem === 'npm' || p.ecosystem === 'PyPI').map((p) => [nameKey(p), p])).values()];
    await pool(unique, 8, async (p) => {
      try {
        out.set(nameKey(p), p.ecosystem === 'npm' ? await this.npm(p.name) : await this.pypi(p.name));
      } catch {
        // Leave missing: the dossier reports these packages as not enriched.
      }
    });
    return out;
  }

  private async npm(name: string): Promise<RegistryMetadata> {
    const doc = (await getJson(this.fetchImpl, `https://registry.npmjs.org/${name.replace('/', '%2f')}`)) as Record<string, unknown>;
    if ('__notFound' in doc) return { exists: false, license: null, latestVersion: null, lastPublishedAt: null, maintainers: null, deprecated: null };
    const latest = ((doc['dist-tags'] ?? {}) as Record<string, string>).latest ?? null;
    const versions = (doc.versions ?? {}) as Record<string, Record<string, unknown>>;
    const lv = latest ? versions[latest] : undefined;
    const lic = lv?.license ?? doc.license;
    const time = (doc.time ?? {}) as Record<string, string>;
    const published = Object.entries(time).filter(([k]) => k !== 'created' && k !== 'modified').map(([, t]) => t).sort().at(-1) ?? null;
    return {
      exists: true,
      license: typeof lic === 'string' ? lic : lic && typeof lic === 'object' ? String((lic as { type?: unknown }).type ?? '') || null : null,
      latestVersion: latest,
      lastPublishedAt: published,
      maintainers: Array.isArray(doc.maintainers) ? doc.maintainers.length : null,
      deprecated: typeof lv?.deprecated === 'string' ? lv.deprecated.slice(0, 200) : null,
    };
  }

  private async pypi(name: string): Promise<RegistryMetadata> {
    const doc = (await getJson(this.fetchImpl, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`)) as Record<string, unknown>;
    if ('__notFound' in doc) return { exists: false, license: null, latestVersion: null, lastPublishedAt: null, maintainers: null, deprecated: null };
    const info = (doc.info ?? {}) as Record<string, unknown>;
    let license: string | null = typeof info.license_expression === 'string' && info.license_expression ? info.license_expression : null;
    if (!license) {
      const cls = (Array.isArray(info.classifiers) ? (info.classifiers as string[]) : []).filter((c) => c.startsWith('License :: OSI Approved :: '));
      if (cls.length === 1) license = cls[0]!.replace('License :: OSI Approved :: ', '');
    }
    if (!license && typeof info.license === 'string' && info.license.length < 80) license = info.license || null;
    const releases = (doc.releases ?? {}) as Record<string, Array<{ upload_time_iso_8601?: string }>>;
    const last = Object.values(releases).flat().map((f) => f.upload_time_iso_8601 ?? '').filter(Boolean).sort().at(-1) ?? null;
    return { exists: true, license, latestVersion: typeof info.version === 'string' ? info.version : null, lastPublishedAt: last, maintainers: null, deprecated: info.yanked === true ? 'yanked' : null };
  }
}

/** GitHub pull request reviews for the review-evidence question. */
export class GitHubForgeProvider implements ForgeProvider {
  readonly name = 'api.github.com';
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly maxPullRequests = 300,
  ) {}

  async pullRequests(numbers: number[]): Promise<Map<number, PullRequestReview>> {
    const out = new Map<number, PullRequestReview>();
    const headers = { authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28', accept: 'application/vnd.github+json' };
    await pool(numbers.slice(0, this.maxPullRequests), 4, async (n) => {
      try {
        const pr = (await getJson(this.fetchImpl, `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${n}`, { headers })) as Record<string, unknown>;
        if ('__notFound' in pr) return;
        const reviews = (await getJson(this.fetchImpl, `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${n}/reviews?per_page=100`, { headers })) as Array<Record<string, unknown>>;
        const approvedBy = Array.isArray(reviews)
          ? [...new Set(reviews.filter((r) => r.state === 'APPROVED').map((r) => String((r.user as { login?: unknown } | null)?.login ?? '')).filter(Boolean))].sort()
          : [];
        out.set(n, {
          number: n,
          author: String((pr.user as { login?: unknown } | null)?.login ?? '') || null,
          approvedBy,
          state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : pr.state === 'open' ? 'open' : 'unknown',
        });
      } catch {
        // Missing entries are reported as unknown review state.
      }
    });
    return out;
  }
}

/** Replays recorded enrichment so a verifier gets byte-identical output. */
export function replayProviders(cache: EnrichmentCache): { vulnerabilities?: VulnerabilityProvider; registry?: RegistryProvider; forge?: ForgeProvider } {
  const out: { vulnerabilities?: VulnerabilityProvider; registry?: RegistryProvider; forge?: ForgeProvider } = {};
  if (cache.vulnerabilities) {
    const rec = cache.vulnerabilities;
    out.vulnerabilities = {
      name: rec.source,
      async query(pkgs) {
        const m = new Map<string, VulnRecord[]>();
        for (const p of pkgs) {
          const r = rec.results[pkgKey(p)];
          if (r) m.set(pkgKey(p), r);
        }
        return m;
      },
    };
    (out.vulnerabilities as { queriedAt?: string }).queriedAt = rec.queriedAt;
  }
  if (cache.registry) {
    const rec = cache.registry;
    out.registry = {
      name: rec.source,
      async lookup(pkgs) {
        const m = new Map<string, RegistryMetadata>();
        for (const p of pkgs) {
          const r = rec.results[nameKey(p)];
          if (r) m.set(nameKey(p), r);
        }
        return m;
      },
    };
    (out.registry as { queriedAt?: string }).queriedAt = rec.queriedAt;
  }
  if (cache.forge) {
    const rec = cache.forge;
    out.forge = {
      name: rec.source,
      async pullRequests(numbers) {
        const m = new Map<number, PullRequestReview>();
        for (const n of numbers) {
          const r = rec.results[String(n)];
          if (r) m.set(n, r);
        }
        return m;
      },
    };
    (out.forge as { queriedAt?: string }).queriedAt = rec.queriedAt;
  }
  return out;
}
