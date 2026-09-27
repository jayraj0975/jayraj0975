import { canonicalJson, sha256Hex } from '../canonical.js';
import type { RepoContext } from '../context.js';
import type { Dependency, EnrichmentRecord } from '../model.js';
import { effectiveCategories, normalizeLicense } from '../licenses/spdx.js';
import type { EnrichmentCache, EnrichmentProviders, ForgeProvider, PackageRef, PullRequestReview, RegistryMetadata, VulnRecord } from './types.js';
import { nameKey, pkgKey } from './types.js';

const OSV_ECOSYSTEMS = new Set(['npm', 'PyPI', 'Go', 'crates.io', 'RubyGems', 'Packagist', 'Maven']);

function queriedAt(provider: object): string {
  const at = (provider as { queriedAt?: unknown }).queriedAt;
  return typeof at === 'string' ? at : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Runs optional network enrichment for every repository in a dossier, reusing
 * responses across repositories and recording them for replay.
 */
export class Enricher {
  readonly cache: EnrichmentCache = {};
  private readonly vulnResults = new Map<string, VulnRecord[]>();
  private readonly registryResults = new Map<string, RegistryMetadata>();
  private readonly forgeResults = new Map<string, PullRequestReview>();

  constructor(private readonly providers: EnrichmentProviders = {}) {}

  async enrich(ctx: RepoContext, deps: Dependency[]): Promise<void> {
    const { findings, evidence, unknowns } = ctx;
    const publicDeps = deps.filter((d) => !d.private && d.version && OSV_ECOSYSTEMS.has(d.ecosystem));
    const prod = (d: Dependency) => d.scope === 'production' || d.scope === 'unknown' || d.scope === 'optional' || d.scope === 'peer';

    // ---- vulnerabilities
    const vp = this.providers.vulnerabilities;
    if (vp) {
      const todo: PackageRef[] = [];
      for (const d of publicDeps) {
        const ref = { ecosystem: d.ecosystem, name: d.name, version: d.version! };
        if (!this.vulnResults.has(pkgKey(ref))) todo.push(ref);
      }
      const at = queriedAt(vp);
      if (todo.length) {
        const res = await vp.query(todo);
        for (const [k, v] of res) this.vulnResults.set(k, v);
      }
      this.cache.vulnerabilities = { source: vp.name, queriedAt: this.cache.vulnerabilities?.queriedAt ?? at, results: Object.fromEntries([...this.vulnResults.entries()].sort()) };
      const material: Array<{ d: Dependency; v: VulnRecord; ev: string }> = [];
      const malicious: Array<{ d: Dependency; v: VulnRecord; ev: string }> = [];
      let notQueried = 0;
      for (const d of publicDeps) {
        const list = this.vulnResults.get(pkgKey({ ecosystem: d.ecosystem, name: d.name, version: d.version! }));
        if (!list) {
          notQueried++;
          continue;
        }
        for (const v of list) {
          const ev = evidence.add({
            kind: 'advisory.match',
            detector: 'vulnerabilities.osv@1',
            state: 'OBSERVED',
            locator: { source: v.url, path: d.sourcePath },
            extract: `${d.name}@${d.version}: ${v.id}${v.aliases.length ? ` (${v.aliases.slice(0, 2).join(', ')})` : ''}`,
            attributes: { severity: v.severity, cvss: v.cvssScore, fixedIn: v.fixedIn.join(',') || null, malicious: v.malicious, scope: d.scope },
          });
          d.evidence = [...new Set([...d.evidence, ev])].sort();
          if (v.malicious) malicious.push({ d, v, ev });
          else if ((v.severity === 'critical' || v.severity === 'high') && prod(d)) material.push({ d, v, ev });
        }
      }
      if (malicious.length) {
        findings.add({
          rule: 'SEC-011',
          state: 'OBSERVED',
          summary: `${malicious.length} dependenc${malicious.length === 1 ? 'y matches' : 'ies match'} a malicious-package advisory: ${malicious.slice(0, 5).map((m) => `${m.d.name}@${m.d.version} (${m.v.id})`).join(', ')}.`,
          evidence: malicious.map((m) => m.ev),
          fingerprint: 'malicious',
        });
      }
      if (material.length) {
        const pkgs = new Set(material.map((m) => `${m.d.name}@${m.d.version}`));
        const critical = material.filter((m) => m.v.severity === 'critical').length;
        findings.add({
          rule: 'SEC-010',
          state: 'OBSERVED',
          summary: `${material.length} high or critical advisories (${critical} critical) affect ${pkgs.size} production dependenc${pkgs.size === 1 ? 'y' : 'ies'} (e.g. ${material.slice(0, 4).map((m) => `${m.d.name}@${m.d.version} ${m.v.id}${m.v.fixedIn.length ? ` fixed in ${m.v.fixedIn[0]}` : ''}`).join('; ')}). Reachability was not assessed.`,
          evidence: material.slice(0, 80).map((m) => m.ev),
          fingerprint: 'vulns',
        });
      }
      if (notQueried) unknowns.add('security', `Vulnerability status of ${notQueried} package version(s)`, 'The advisory source returned no result for them.', 'Re-run with vulnerability enrichment.', false);
    } else if (publicDeps.length) {
      unknowns.add('security', `Known vulnerabilities in ${publicDeps.length} dependency version(s)`, 'Vulnerability enrichment (OSV) was not enabled for this analysis, so no advisories were checked. This is not the same as "no vulnerabilities".', 'Re-run with vulnerability enrichment enabled.');
    }
    const privateCount = deps.filter((d) => d.private).length;
    if (privateCount) unknowns.add('security', `Vulnerability and license status of ${privateCount} private package(s)`, 'Private packages are never sent to external services.', 'Provide advisories or an SBOM for private packages.', false);

    // ---- registry metadata: licenses where the lockfile had none, freshness
    const rp = this.providers.registry;
    const regCandidates = deps.filter((d) => !d.private && (d.ecosystem === 'npm' || d.ecosystem === 'PyPI') && prod(d));
    if (rp) {
      const todo = regCandidates.filter((d) => !this.registryResults.has(nameKey(d))).map((d) => ({ ecosystem: d.ecosystem, name: d.name }));
      const at = queriedAt(rp);
      if (todo.length) {
        const res = await rp.lookup(todo);
        for (const [k, v] of res) this.registryResults.set(k, v);
      }
      this.cache.registry = { source: rp.name, queriedAt: this.cache.registry?.queriedAt ?? at, results: Object.fromEntries([...this.registryResults.entries()].sort()) };
      const asOf = Date.parse(this.cache.registry.queriedAt);
      const stale: Dependency[] = [];
      for (const d of regCandidates) {
        const meta = this.registryResults.get(nameKey(d));
        if (!meta || !meta.exists) continue;
        if ((!d.license || d.license.certainty === 'UNKNOWN') && meta.license) {
          const norm = normalizeLicense(meta.license);
          const ev = evidence.add({ kind: 'registry.license', detector: 'licenses.registry@1', state: 'OBSERVED', locator: { source: `${rp.name}/${d.name}` }, extract: meta.license, attributes: { latestVersion: meta.latestVersion, version: d.version } });
          const sameVersion = meta.latestVersion === d.version;
          if (norm.expression && !norm.expression.startsWith('LicenseRef-Unrecognised')) {
            d.license = {
              expression: norm.expression,
              // Registry license describes the latest release; for older versions it is an inference.
              certainty: norm.exact && sameVersion ? 'KNOWN' : 'LIKELY',
              state: norm.exact && sameVersion ? 'OBSERVED' : 'INFERRED',
              categories: norm.proprietary ? ['proprietary'] : effectiveCategories(norm.node),
              source: 'registry',
              evidence: [ev],
            };
          }
        }
        if (meta.lastPublishedAt && asOf - Date.parse(meta.lastPublishedAt) > 730 * 86_400_000 && d.direct) stale.push(d);
      }
      if (stale.length) {
        findings.add({
          rule: 'MNT-004',
          state: 'OBSERVED',
          summary: `${stale.length} direct production dependenc${stale.length === 1 ? 'y has' : 'ies have'} had no release in over two years (${stale.slice(0, 5).map((d) => d.name).join(', ')}).`,
          evidence: stale.slice(0, 30).flatMap((d) => d.evidence.slice(0, 1)),
          fingerprint: 'stale-deps',
        });
      }
    }
  }

  forgeFor(forge: ForgeProvider | undefined): (prs: number[]) => Promise<Map<number, PullRequestReview> | null> {
    return async (prs) => {
      if (!forge) return null;
      const todo = prs.filter((n) => !this.forgeResults.has(`${forge.name}#${n}`));
      if (todo.length) {
        const res = await forge.pullRequests(todo);
        for (const [n, r] of res) this.forgeResults.set(`${forge.name}#${n}`, r);
      }
      const at = queriedAt(forge);
      this.cache.forge = {
        source: forge.name,
        queriedAt: this.cache.forge?.queriedAt ?? at,
        results: Object.fromEntries([...this.forgeResults.entries()].map(([k, v]) => [k.split('#').pop()!, v]).sort()),
      };
      const m = new Map<number, PullRequestReview>();
      for (const n of prs) {
        const r = this.forgeResults.get(`${forge.name}#${n}`);
        if (r) m.set(n, r);
      }
      return m;
    };
  }

  records(): EnrichmentRecord[] {
    const out: EnrichmentRecord[] = [];
    const v = this.cache.vulnerabilities;
    out.push(v ? { source: v.source, performed: true, queriedAt: v.queriedAt, items: Object.keys(v.results).length, digest: sha256Hex(canonicalJson(v.results)) } : { source: 'vulnerabilities', performed: false, reason: 'not enabled', items: 0 });
    const r = this.cache.registry;
    out.push(r ? { source: r.source, performed: true, queriedAt: r.queriedAt, items: Object.keys(r.results).length, digest: sha256Hex(canonicalJson(r.results)) } : { source: 'package registries', performed: false, reason: 'not enabled', items: 0 });
    const f = this.cache.forge;
    out.push(f ? { source: f.source, performed: true, queriedAt: f.queriedAt, items: Object.keys(f.results).length, digest: sha256Hex(canonicalJson(f.results)) } : { source: 'forge reviews', performed: false, reason: 'not connected', items: 0 });
    return out;
  }
}
