import type { RepoContext } from '../context.js';
import type { Dependency, LicenseCategory, LicenseConclusion, LicenseSummary } from '../model.js';
import { identifyLicenseText, isLicenseFileName } from '../licenses/identify.js';
import { categoryOf, effectiveCategories, normalizeLicense } from '../licenses/spdx.js';
import { basename, dirname } from '../util/paths.js';
import { LineIndex } from '../util/text.js';
import { parsePackageJson } from '../ecosystems/npm.js';
import { parseCargoToml, parseComposerJson, parsePyproject } from '../ecosystems/others.js';

const SPDX_HEADER = /SPDX-License-Identifier:\s*([A-Za-z0-9.+ ()-]+?)\s*(?:\*\/|-->|$)/m;

export function analyzeProjectLicense(ctx: RepoContext): LicenseSummary['project'] {
  const { evidence, findings } = ctx;
  const rootLicenseFiles = ctx.files.filter((f) => dirname(f.path) === '' && isLicenseFileName(basename(f.path)) && !/^notice/i.test(basename(f.path)));
  const identified: Array<{ path: string; id: string | null; certainty: 'KNOWN' | 'LIKELY' | 'UNKNOWN'; custom: boolean; proprietary: boolean; ev: string }> = [];
  for (const f of rootLicenseFiles) {
    const text = ctx.text.get(f.path);
    if (text === undefined) continue;
    const r = identifyLicenseText(text);
    const ev = evidence.add({
      kind: 'file.license_text',
      detector: 'licenses.identify@1',
      state: r.certainty === 'KNOWN' ? 'OBSERVED' : r.certainty === 'LIKELY' ? 'INFERRED' : 'OBSERVED',
      locator: { path: f.path },
      extract: r.id ?? (r.proprietary ? 'proprietary notice' : 'unidentified license text'),
      attributes: { certainty: r.certainty, custom: r.custom, matched: r.matched.length },
    });
    identified.push({ path: f.path, id: r.id, certainty: r.certainty, custom: r.custom, proprietary: r.proprietary, ev });
    if (r.custom && r.certainty !== 'KNOWN') {
      findings.add({
        rule: 'LIC-014',
        state: 'OBSERVED',
        summary: `${f.path} contains license text that ${r.id ? `resembles ${r.id} but differs from it (additional or changed terms)` : 'does not match any standard license'}.`,
        evidence: [ev],
        fingerprint: `custom:${f.path}`,
      });
    }
  }

  // Licenses declared in root manifests.
  const declared: Array<{ path: string; expression: string; ev: string }> = [];
  const manifestParsers: Array<[string, (p: string, t: string) => { license?: string } | null]> = [
    ['package.json', parsePackageJson],
    ['pyproject.toml', parsePyproject],
    ['Cargo.toml', parseCargoToml],
    ['composer.json', parseComposerJson],
  ];
  for (const [name, parse] of manifestParsers) {
    const t = ctx.text.get(name);
    if (!t) continue;
    const m = parse(name, t);
    if (!m?.license) continue;
    const norm = normalizeLicense(m.license);
    const expr = norm.expression ?? m.license;
    declared.push({ path: name, expression: expr, ev: evidence.add({ kind: 'manifest.license', detector: 'licenses.metadata@1', state: 'OBSERVED', locator: { path: name }, extract: m.license, attributes: {} }) });
  }

  const fileIds = identified.filter((i) => i.id).map((i) => i.id!);
  const declaredIds = declared.map((d) => d.expression).filter((e) => e !== 'LicenseRef-Proprietary');
  const sameFamily = (a: string, b: string) => a.replace(/-(only|or-later)$/, '').replace(/\+$/, '') === b.replace(/-(only|or-later)$/, '').replace(/\+$/, '');
  const conflicts = fileIds.length && declaredIds.length && !declaredIds.every((d) => fileIds.some((f) => sameFamily(f, d) || d.includes(f)));
  const declaredProprietary = declared.some((d) => d.expression === 'LicenseRef-Proprietary');
  if (conflicts || (declaredProprietary && fileIds.some((id) => categoryOf(id) !== 'proprietary'))) {
    findings.add({
      rule: 'LIC-002',
      state: 'CONFLICTING',
      summary: `The license file says ${fileIds.join(', ')} but ${declared.map((d) => `${d.path} declares "${d.expression}"`).join('; ')}.`,
      evidence: [...identified.map((i) => i.ev), ...declared.map((d) => d.ev)],
      fingerprint: 'project-license',
    });
  }

  let conclusion: LicenseConclusion;
  const primary = identified.find((i) => i.id) ?? null;
  if (primary) {
    const norm = normalizeLicense(primary.id!);
    conclusion = {
      expression: primary.id,
      certainty: primary.certainty,
      state: conflicts ? 'CONFLICTING' : primary.certainty === 'KNOWN' ? 'OBSERVED' : 'INFERRED',
      categories: effectiveCategories(norm.node),
      source: 'license_file',
      evidence: [...identified.map((i) => i.ev), ...declared.map((d) => d.ev)],
    };
  } else if (declared.length) {
    const norm = normalizeLicense(declared[0]!.expression);
    conclusion = {
      expression: norm.expression,
      certainty: norm.exact || norm.proprietary ? 'KNOWN' : 'LIKELY',
      state: 'OBSERVED',
      categories: norm.proprietary ? ['proprietary'] : effectiveCategories(norm.node),
      source: 'manifest',
      evidence: declared.map((d) => d.ev),
    };
  } else if (identified.some((i) => i.proprietary)) {
    conclusion = { expression: 'LicenseRef-Proprietary', certainty: 'LIKELY', state: 'INFERRED', categories: ['proprietary'], source: 'license_file', evidence: identified.map((i) => i.ev) };
  } else {
    conclusion = { expression: null, certainty: 'UNKNOWN', state: 'UNKNOWN', categories: ['unknown'], source: 'none', evidence: identified.map((i) => i.ev) };
  }

  const cats = conclusion.categories;
  if (cats.some((c) => c === 'strong_copyleft' || c === 'network_copyleft')) {
    findings.add({
      rule: 'LIC-003',
      state: conclusion.state,
      summary: `The repository itself is licensed ${conclusion.expression}. If this is the company's product, confirm that publishing it under a copyleft license is intended and consistent with commercial plans.`,
      evidence: conclusion.evidence,
      fingerprint: 'project-copyleft',
    });
  }

  // File-level SPDX identifiers in first-party code that differ from the project license.
  const projectId = conclusion.expression ?? '';
  const differing: Array<{ path: string; id: string; ev: string }> = [];
  for (const f of ctx.files) {
    if (f.classes.includes('vendored') || f.classes.includes('generated')) continue;
    if (!f.classes.includes('source') && !f.classes.includes('test')) continue;
    const text = ctx.text.get(f.path);
    if (!text) continue;
    const head = text.slice(0, 3000);
    const m = SPDX_HEADER.exec(head);
    if (!m) continue;
    const id = m[1]!.trim();
    const norm = normalizeLicense(id);
    const expr = norm.expression ?? id;
    if (projectId && (expr === projectId || expr.includes(projectId))) continue;
    const cats2 = effectiveCategories(norm.node);
    const line = new LineIndex(head).lineOf(m.index);
    const ev = evidence.add({ kind: 'file.spdx_identifier', detector: 'licenses.spdx_header@1', state: 'OBSERVED', locator: { path: f.path, line }, extract: expr, attributes: { category: cats2.join(',') } });
    differing.push({ path: f.path, id: expr, ev });
  }
  if (differing.length) {
    const ids = [...new Set(differing.map((d) => d.id))];
    findings.add({
      rule: 'OWN-007',
      state: 'OBSERVED',
      summary: `${differing.length} first-party file(s) declare ${ids.slice(0, 4).join(', ')} in SPDX headers${projectId ? `, differing from the project license (${projectId})` : ' while the project license is not established'} (e.g. ${differing.slice(0, 3).map((d) => d.path).join(', ')}).`,
      evidence: differing.slice(0, 60).map((d) => d.ev),
      fingerprint: `spdx:${ids.sort().join('|')}`,
    });
  }

  return { ...conclusion, files: rootLicenseFiles.map((f) => f.path) };
}

export function dependencyLicenseFindings(ctx: RepoContext, deps: Dependency[]): void {
  const { findings } = ctx;
  const distribution = ctx.declarations?.distribution ?? null;
  const prodLike = deps.filter((d) => (d.scope === 'production' || d.scope === 'unknown' || d.scope === 'optional' || d.scope === 'peer') && !d.private);
  const byCat = (cats: LicenseCategory[]) => prodLike.filter((d) => d.license && d.license.categories.some((c) => cats.includes(c)));
  const fmt = (list: Dependency[]) => list.slice(0, 6).map((d) => `${d.name}${d.version ? `@${d.version}` : ''} (${d.license?.expression ?? '?'})`).join(', ');
  const scopeNote = (list: Dependency[]) => (list.some((d) => d.scope === 'unknown') ? ' Some have an unknown scope (the lockfile format does not record it) and are treated as production.' : '');

  const network = byCat(['network_copyleft']);
  const strong = byCat(['strong_copyleft']);
  const copyleftState = (list: Dependency[]) => (list.every((d) => d.license?.certainty === 'KNOWN') ? 'OBSERVED' : 'INFERRED');
  if (network.length) {
    const knownNet = network.filter((d) => d.license?.certainty === 'KNOWN');
    const blocking = knownNet.length > 0 && distribution !== null && distribution !== 'internal';
    findings.add({
      rule: 'LIC-010',
      state: copyleftState(network),
      materiality: blocking ? 'blocking' : 'material',
      title: 'Network copyleft (AGPL-family) licenses in production dependencies',
      summary: `${network.length} production dependenc${network.length === 1 ? 'y is' : 'ies are'} under a network copyleft license: ${fmt(network)}. Network copyleft can require source disclosure to users who interact with the software over a network.${distribution ? ` Declared distribution model: ${distribution}.` : ' The distribution model has not been declared.'} Counsel should review before close.${scopeNote(network)}`,
      evidence: network.slice(0, 50).flatMap((d) => [...d.evidence, ...(d.license?.evidence ?? [])]),
      fingerprint: 'network-copyleft',
    });
  }
  if (strong.length) {
    const distributed = distribution !== null && ['distributed', 'on_prem', 'mobile', 'library', 'mixed'].includes(distribution);
    const knownStrong = strong.filter((d) => d.license?.certainty === 'KNOWN');
    findings.add({
      rule: 'LIC-010',
      state: copyleftState(strong),
      materiality: distributed && knownStrong.length ? 'blocking' : 'material',
      title: 'Strong copyleft (GPL-family) licenses in production dependencies',
      summary: `${strong.length} production dependenc${strong.length === 1 ? 'y is' : 'ies are'} under a strong copyleft license: ${fmt(strong)}.${distribution ? ` Declared distribution model: ${distribution}.` : ' The distribution model has not been declared; obligations depend on whether the software is distributed.'} Counsel should review.${scopeNote(strong)}`,
      evidence: strong.slice(0, 50).flatMap((d) => [...d.evidence, ...(d.license?.evidence ?? [])]),
      fingerprint: 'strong-copyleft',
    });
  }
  const weak = byCat(['weak_copyleft']);
  if (weak.length) {
    findings.add({
      rule: 'LIC-011',
      state: copyleftState(weak),
      summary: `${weak.length} production dependenc${weak.length === 1 ? 'y is' : 'ies are'} under weak copyleft licenses: ${fmt(weak)}.${scopeNote(weak)}`,
      evidence: weak.slice(0, 50).flatMap((d) => [...d.evidence, ...(d.license?.evidence ?? [])]),
      fingerprint: 'weak-copyleft',
    });
  }
  const restricted = byCat(['source_available']);
  if (restricted.length) {
    findings.add({
      rule: 'LIC-012',
      state: copyleftState(restricted),
      summary: `${restricted.length} production dependenc${restricted.length === 1 ? 'y is' : 'ies are'} under source-available or use-restricted licenses: ${fmt(restricted)}.${scopeNote(restricted)}`,
      evidence: restricted.slice(0, 50).flatMap((d) => [...d.evidence, ...(d.license?.evidence ?? [])]),
      fingerprint: 'source-available',
    });
  }
  const unknown = prodLike.filter((d) => !d.license || d.license.certainty === 'UNKNOWN');
  if (unknown.length) {
    const total = prodLike.length;
    findings.add({
      rule: 'LIC-013',
      state: 'DERIVED',
      materiality: unknown.length / Math.max(total, 1) > 0.25 ? 'material' : 'minor',
      summary: `${unknown.length} of ${total} production dependencies have no license information in the analysed sources (e.g. ${unknown.slice(0, 5).map((d) => d.name).join(', ')}).${ctx.options.enrichment?.registry ? '' : ' Registry lookup was not enabled.'}`,
      evidence: unknown.slice(0, 30).flatMap((d) => d.evidence),
      fingerprint: 'unknown-licenses',
    });
  }
}

export function summarizeLicenses(project: LicenseSummary['project'], deps: Dependency[]): LicenseSummary {
  const byCategory: Record<LicenseCategory, number> = {
    permissive: 0, weak_copyleft: 0, strong_copyleft: 0, network_copyleft: 0, source_available: 0, public_domain: 0, proprietary: 0, content: 0, unknown: 0,
  };
  let known = 0;
  let likely = 0;
  let unknown = 0;
  for (const d of deps) {
    const l = d.license;
    if (!l || l.certainty === 'UNKNOWN') unknown++;
    else if (l.certainty === 'KNOWN') known++;
    else likely++;
    for (const c of l?.categories ?? ['unknown']) byCategory[c]++;
  }
  return { project, byCategory, known, likely, unknown };
}
