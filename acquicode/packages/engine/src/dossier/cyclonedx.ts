import { sha256Hex } from '../canonical.js';
import type { Dependency, Dossier } from '../model.js';
import { dossierDigest } from '../analyze.js';

function purl(d: Dependency): string | undefined {
  if (!d.version) return undefined;
  const v = encodeURIComponent(d.version);
  switch (d.ecosystem) {
    case 'npm': {
      if (d.name.startsWith('@')) {
        const [scope, name] = d.name.split('/');
        return `pkg:npm/${encodeURIComponent(scope!)}/${encodeURIComponent(name ?? '')}@${v}`;
      }
      return `pkg:npm/${encodeURIComponent(d.name)}@${v}`;
    }
    case 'PyPI':
      return `pkg:pypi/${encodeURIComponent(d.name.toLowerCase())}@${v}`;
    case 'Go':
      return `pkg:golang/${d.name.split('/').map(encodeURIComponent).join('/')}@${v}`;
    case 'crates.io':
      return `pkg:cargo/${encodeURIComponent(d.name)}@${v}`;
    case 'RubyGems':
      return `pkg:gem/${encodeURIComponent(d.name)}@${v}`;
    case 'Packagist':
      return `pkg:composer/${d.name.split('/').map(encodeURIComponent).join('/')}@${v}`;
    case 'Maven': {
      const [g, a] = d.name.split(':');
      return `pkg:maven/${encodeURIComponent(g ?? '')}/${encodeURIComponent(a ?? '')}@${v}`;
    }
    default:
      return undefined;
  }
}

function uuidFrom(hex: string): string {
  const h = hex.slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * CycloneDX 1.6 JSON. Completeness is stated per component with `compositions`
 * rather than implied: a manifest without a lockfile is "incomplete", vendored
 * code is "unknown".
 */
export function toCycloneDx(dossier: Dossier): Record<string, unknown> {
  const digest = dossierDigest(dossier);
  const components = dossier.dependencies.map((d) => {
    const ref = `dep:${d.id}`;
    const c: Record<string, unknown> = {
      type: 'library',
      'bom-ref': ref,
      name: d.name,
      scope: d.scope === 'development' ? 'excluded' : d.scope === 'optional' ? 'optional' : 'required',
    };
    if (d.version) c.version = d.version;
    const p = purl(d);
    if (p) c.purl = p;
    if (d.license?.expression && d.license.certainty !== 'UNKNOWN' && !d.license.expression.startsWith('SEE LICENSE')) {
      c.licenses = [{ expression: d.license.expression }];
    }
    const props = [
      { name: 'acquicode:ecosystem', value: d.ecosystem },
      { name: 'acquicode:direct', value: String(d.direct) },
      { name: 'acquicode:component', value: d.component },
      { name: 'acquicode:license-certainty', value: d.license?.certainty ?? 'UNKNOWN' },
      { name: 'acquicode:license-state', value: d.license?.state ?? 'UNKNOWN' },
      { name: 'acquicode:private', value: String(d.private) },
      { name: 'acquicode:source', value: `${d.source}:${d.sourcePath}` },
    ];
    if (d.repository && dossier.subjects.length > 1) props.push({ name: 'acquicode:repository', value: d.repository });
    c.properties = props;
    return c;
  });
  const compositions = dossier.components.map((cmp) => ({
    aggregate: cmp.lockfilePath ? 'complete' : 'incomplete',
    assemblies: dossier.dependencies.filter((d) => d.component === `${cmp.ecosystem}:${cmp.name}` && (!cmp.repository || d.repository === cmp.repository)).map((d) => `dep:${d.id}`),
  }));
  const vendored = dossier.dependencies.filter((d) => d.source === 'vendored');
  if (vendored.length) compositions.push({ aggregate: 'unknown', assemblies: vendored.map((d) => `dep:${d.id}`) });
  const subject = dossier.subjects[0]!;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${uuidFrom(sha256Hex(`cyclonedx:${digest}`))}`,
    version: 1,
    metadata: {
      tools: { components: [{ type: 'application', name: dossier.analyzer.name, version: dossier.analyzer.version }] },
      component: {
        type: 'application',
        'bom-ref': 'root',
        name: dossier.title,
        ...(subject.headCommit ? { version: subject.headCommit.slice(0, 12) } : {}),
      },
      properties: [
        { name: 'acquicode:dossier-digest', value: digest },
        { name: 'acquicode:rules-version', value: dossier.analyzer.rulesVersion },
      ],
    },
    components,
    compositions,
  };
}
