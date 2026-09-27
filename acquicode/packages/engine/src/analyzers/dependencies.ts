import { stableId, sortBy } from '../canonical.js';
import type { RepoContext } from '../context.js';
import type { Component, Dependency, DependencyScope, LicenseConclusion, ProvenanceState } from '../model.js';
import { parseNpmrc, parsePackageJson, parsePackageLock, parsePnpmLock, parseYarnLock } from '../ecosystems/npm.js';
import {
  parseCargoLock,
  parseCargoToml,
  parseComposerJson,
  parseComposerLock,
  parseGemfile,
  parseGemfileLock,
  parseGoMod,
  parsePipfile,
  parsePipfileLock,
  parsePom,
  parsePyproject,
  parsePythonTomlLock,
  parseRequirements,
  pyName,
} from '../ecosystems/others.js';
import type { LockInfo, ManifestInfo, ParsedDependency } from '../ecosystems/types.js';
import { effectiveCategories, normalizeLicense } from '../licenses/spdx.js';
import { identifyLicenseText, isLicenseFileName } from '../licenses/identify.js';
import { basename, dirname } from '../util/paths.js';
import { vendoredRoot } from './classify.js';
import { POPULAR, editDistance } from './popular.js';

const PUBLIC_HOSTS = /^(https?:\/\/)?(registry\.npmjs\.org|registry\.yarnpkg\.com|registry\.npmmirror\.com|pypi\.org|files\.pythonhosted\.org|crates\.io|index\.crates\.io|static\.crates\.io|rubygems\.org|repo\.packagist\.org|repo\.maven\.apache\.org|repo1\.maven\.org|codeload\.github\.com|github\.com|gitlab\.com|bitbucket\.org)(\/|$)/i;

export interface DependencyResult {
  components: Component[];
  dependencies: Dependency[];
  manifests: string[];
  lockfiles: string[];
}

interface Pairing {
  manifest: ManifestInfo;
  lock: LockInfo | null;
  lockPath: string | null;
}

export function analyzeDependencies(ctx: RepoContext): DependencyResult {
  const { evidence, findings, unknowns } = ctx;
  const text = (p: string) => ctx.text.get(p);
  const firstParty = ctx.files.filter((f) => !vendoredRoot(f.path));
  const manifests: string[] = [];
  const lockfiles: string[] = [];
  const locks = new Map<string, LockInfo>();
  const pairs: Pairing[] = [];

  // ---- parse lockfiles first so manifests can find them
  for (const f of firstParty) {
    const b = basename(f.path);
    const t = text(f.path);
    if (t === undefined) continue;
    let lock: LockInfo | null = null;
    if (b === 'package-lock.json' || b === 'npm-shrinkwrap.json') lock = parsePackageLock(f.path, t);
    else if (b === 'yarn.lock') lock = parseYarnLock(f.path, t);
    else if (b === 'pnpm-lock.yaml') lock = parsePnpmLock(f.path, t);
    else if (b === 'poetry.lock' || b === 'uv.lock' || b === 'pdm.lock') lock = parsePythonTomlLock(f.path, t);
    else if (b === 'Pipfile.lock') lock = parsePipfileLock(f.path, t);
    else if (b === 'Cargo.lock') lock = parseCargoLock(f.path, t);
    else if (b === 'Gemfile.lock') lock = parseGemfileLock(f.path, t);
    else if (b === 'composer.lock') lock = parseComposerLock(f.path, t);
    if (lock) {
      locks.set(f.path, lock);
      lockfiles.push(f.path);
    } else if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock)$/.test(b)) {
      lockfiles.push(f.path);
      unknowns.add('reproducibility', `Contents of ${f.path}`, 'The lockfile could not be parsed (malformed or unsupported format).', 'Regenerate the lockfile with the package manager.', true);
    }
  }

  const findLock = (dir: string, names: string[]): string | null => {
    let d = dir;
    for (;;) {
      for (const n of names) {
        const p = d ? `${d}/${n}` : n;
        if (locks.has(p)) return p;
      }
      if (!d) return null;
      d = dirname(d);
    }
  };

  // ---- manifests
  let npmrc = { privateScopes: [] as string[], defaultRegistry: null as string | null };
  const npmrcText = text('.npmrc');
  if (npmrcText) npmrc = parseNpmrc(npmrcText);
  const privateIndexes: string[] = [];

  for (const f of firstParty) {
    const b = basename(f.path);
    const t = text(f.path);
    if (t === undefined) continue;
    const dir = dirname(f.path);
    if (b === 'package.json') {
      const m = parsePackageJson(f.path, t);
      if (!m) continue;
      manifests.push(f.path);
      const lockPath = findLock(dir, ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']);
      pairs.push({ manifest: m, lock: lockPath ? locks.get(lockPath)! : null, lockPath });
    } else if (b === 'pyproject.toml') {
      const m = parsePyproject(f.path, t);
      if (!m) continue;
      manifests.push(f.path);
      const lockPath = findLock(dir, ['poetry.lock', 'uv.lock', 'pdm.lock']);
      pairs.push({ manifest: m, lock: lockPath ? locks.get(lockPath)! : null, lockPath });
    } else if (b === 'Pipfile') {
      const m = parsePipfile(f.path, t);
      if (!m) continue;
      manifests.push(f.path);
      const lockPath = findLock(dir, ['Pipfile.lock']);
      pairs.push({ manifest: m, lock: lockPath ? locks.get(lockPath)! : null, lockPath });
    } else if (/^requirements([-_.].*)?\.txt$/i.test(b)) {
      manifests.push(f.path);
      const { manifest, lock } = parseRequirements(f.path, t);
      for (const idx of t.matchAll(/--(?:extra-)?index-url\s+(\S+)/g)) if (!PUBLIC_HOSTS.test(idx[1]!)) privateIndexes.push(`${f.path}: ${redact(idx[1]!)}`);
      if (/--extra-index-url\s+\S+/.test(t)) {
        const extra = [...t.matchAll(/--extra-index-url\s+(\S+)/g)].map((x) => x[1]!).filter((u) => !PUBLIC_HOSTS.test(u));
        if (extra.length) {
          const id = evidence.add({ kind: 'config.extra_index_url', detector: 'supplychain.extra_index@1', state: 'OBSERVED', locator: { path: f.path }, extract: `--extra-index-url ${redact(extra[0]!)}`, attributes: {} });
          findings.add({
            rule: 'SEC-033',
            state: 'OBSERVED',
            summary: `${f.path} adds a private index with --extra-index-url. pip considers every index and installs the highest version, so a public package with the same name as a private one can be installed instead.`,
            evidence: [id],
            fingerprint: `extra-index:${f.path}`,
          });
        }
      }
      if (lock) {
        locks.set(f.path, lock);
        if (!lockfiles.includes(f.path)) lockfiles.push(f.path);
      }
      pairs.push({ manifest, lock, lockPath: lock ? f.path : null });
    } else if (b === 'go.mod') {
      manifests.push(f.path);
      const { manifest, lock } = parseGoMod(f.path, t);
      const sum = ctx.fileIndex.has(dir ? `${dir}/go.sum` : 'go.sum');
      if (sum) lockfiles.push(dir ? `${dir}/go.sum` : 'go.sum');
      if (!sum && lock.deps.length) {
        findings.add({ rule: 'SEC-032', state: 'OBSERVED', summary: `${f.path} requires ${lock.deps.length} module(s) but no go.sum is committed, so module checksums are not recorded.`, evidence: [], fingerprint: `gosum:${f.path}`, component: manifest.name });
      }
      pairs.push({ manifest, lock, lockPath: f.path });
    } else if (b === 'Cargo.toml') {
      const m = parseCargoToml(f.path, t);
      if (!m) continue;
      manifests.push(f.path);
      const lockPath = findLock(dir, ['Cargo.lock']);
      pairs.push({ manifest: m, lock: lockPath ? locks.get(lockPath)! : null, lockPath });
    } else if (b === 'Gemfile') {
      manifests.push(f.path);
      const lockPath = findLock(dir, ['Gemfile.lock']);
      pairs.push({ manifest: parseGemfile(f.path, t), lock: lockPath ? locks.get(lockPath)! : null, lockPath });
    } else if (b === 'composer.json') {
      const m = parseComposerJson(f.path, t);
      if (!m) continue;
      manifests.push(f.path);
      const lockPath = findLock(dir, ['composer.lock']);
      pairs.push({ manifest: m, lock: lockPath ? locks.get(lockPath)! : null, lockPath });
    } else if (b === 'pom.xml') {
      manifests.push(f.path);
      const { manifest, lock } = parsePom(f.path, t);
      const unresolved = lock.deps.filter((d) => d.version === null);
      if (unresolved.length) {
        findings.add({
          rule: 'REP-003',
          state: 'OBSERVED',
          summary: `${f.path}: ${unresolved.length} dependenc${unresolved.length === 1 ? 'y has' : 'ies have'} a version range, a property reference or a version managed elsewhere (e.g. ${unresolved.slice(0, 3).map((d) => d.name).join(', ')}); the resolved version is not recorded in this file.`,
          evidence: [],
          fingerprint: `pom:${f.path}`,
          component: manifest.name,
        });
      }
      pairs.push({ manifest, lock, lockPath: f.path });
    }
  }

  // ---- vendored package metadata (licenses observed on disk)
  const vendoredLicense = new Map<string, { license: string | null; evidence: string; state: ProvenanceState }>();
  const vendoredPackages = new Map<string, string[]>();
  for (const f of ctx.files) {
    const root = vendoredRoot(f.path);
    if (!root) continue;
    const pkgDir = vendoredPackageDir(f.path, root);
    if (!pkgDir) continue;
    vendoredPackages.set(pkgDir, [...(vendoredPackages.get(pkgDir) ?? []), f.path]);
  }
  for (const [pkgDir, files] of vendoredPackages) {
    const pj = text(`${pkgDir}/package.json`);
    let license: string | null = null;
    let evidenceId: string | null = null;
    if (pj) {
      const m = parsePackageJson(`${pkgDir}/package.json`, pj);
      if (m?.license) {
        license = m.license;
        evidenceId = evidence.add({ kind: 'vendored.package_license', detector: 'licenses.vendored@1', state: 'OBSERVED', locator: { path: `${pkgDir}/package.json` }, extract: m.license, attributes: {} });
      }
      if (m && m.name) vendoredLicense.set(`npm:${m.name}`, { license, evidence: evidenceId ?? '', state: 'OBSERVED' });
    }
    const licFile = files.find((p) => dirname(p) === pkgDir && isLicenseFileName(basename(p)));
    if (licFile) {
      const lt = text(licFile);
      const ident = lt ? identifyLicenseText(lt) : null;
      const id = evidence.add({
        kind: 'vendored.license_file',
        detector: 'licenses.vendored@1',
        state: 'OBSERVED',
        locator: { path: licFile },
        extract: ident?.id ?? 'unidentified license text',
        attributes: { certainty: ident?.certainty ?? 'UNKNOWN' },
      });
      if (!license && ident?.id) license = ident.id;
      if (!evidenceId) evidenceId = id;
    } else if (!license) {
      const id = evidence.add({ kind: 'vendored.no_license', detector: 'licenses.vendored@1', state: 'OBSERVED', locator: { path: pkgDir }, attributes: { files: files.length } });
      findings.add({
        rule: 'OWN-011',
        state: 'OBSERVED',
        summary: `Vendored code at ${pkgDir} (${files.length} file${files.length === 1 ? '' : 's'}) has no license file or license metadata.`,
        evidence: [id],
        fingerprint: pkgDir,
      });
    }
  }

  // Names that carry the company's own name are treated as internal and never sent to public services.
  const companyTokens = [
    ...(ctx.declarations?.company.domains ?? []).map((d) => d.split('.')[0]!),
    ...(ctx.declarations?.company.names ?? []).map((n) => n.split(/[\s,]+/)[0]!),
  ]
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4);

  // ---- build components and dependencies
  const components: Component[] = [];
  const dependencies: Dependency[] = [];
  const seenLockForComponent = new Set<string>();
  for (const { manifest, lock, lockPath } of sortBy(pairs, (p) => p.manifest.path)) {
    const compName = `${manifest.ecosystem}:${manifest.name}`;
    const isSelfLock = lockPath === manifest.path;
    const hasDirect = manifest.direct.size > 0;
    const component: Component = {
      id: stableId('cmp', ctx.repoName, manifest.path),
      name: manifest.name,
      ecosystem: manifest.ecosystem,
      manifestPath: manifest.path,
      lockfilePath: lockPath,
      dependencyCount: { direct: manifest.direct.size, transitive: 0 },
    };
    component.repository = ctx.repoName;
    components.push(component);

    if (!lock && hasDirect) {
      findings.add({
        rule: 'REP-001',
        state: 'OBSERVED',
        summary: `${manifest.path} declares ${manifest.direct.size} ${manifest.ecosystem} dependenc${manifest.direct.size === 1 ? 'y' : 'ies'} but no lockfile was found, so the exact versions installed are not recorded.`,
        evidence: [evidence.add({ kind: 'manifest.no_lockfile', detector: 'reproducibility.lockfile@1', state: 'OBSERVED', locator: { path: manifest.path }, attributes: { direct: manifest.direct.size } })],
        fingerprint: `nolock:${manifest.path}`,
        component: compName,
      });
    }

    // Drift: names the manifest asks for that the lockfile does not contain.
    if (lock && !isSelfLock && hasDirect) {
      const lockNames = new Set(lock.deps.map((d) => normName(manifest.ecosystem, d.name)));
      let importerDeclared: Map<string, string> | undefined;
      if (lock.importers) {
        const rel = relativeImporter(lockPath!, manifest.path);
        importerDeclared = lock.importers.get(rel) ?? lock.importers.get(rel === '' ? '.' : rel);
      }
      const missing: string[] = [];
      const changed: string[] = [];
      for (const [name, { requirement }] of manifest.direct) {
        if (/^(file:|link:|workspace:|portal:)/.test(requirement)) continue;
        if (manifest.ecosystem === 'crates.io' && !/\d|\*/.test(requirement)) continue; // path/git deps
        if (!lockNames.has(normName(manifest.ecosystem, name))) missing.push(name);
        else if (importerDeclared && importerDeclared.has(name) && importerDeclared.get(name) !== requirement) changed.push(`${name} (${importerDeclared.get(name)} → ${requirement})`);
      }
      if (missing.length || changed.length) {
        const id = evidence.add({
          kind: 'lockfile.drift',
          detector: 'reproducibility.drift@1',
          state: 'OBSERVED',
          locator: { path: lockPath! },
          extract: [...missing.slice(0, 5), ...changed.slice(0, 5)].join(', '),
          attributes: { manifest: manifest.path, missing: missing.length, changed: changed.length },
        });
        findings.add({
          rule: 'REP-002',
          state: 'OBSERVED',
          summary: `${lockPath} does not match ${manifest.path}: ${missing.length ? `${missing.length} declared dependenc${missing.length === 1 ? 'y is' : 'ies are'} missing from the lockfile (${missing.slice(0, 4).join(', ')})` : ''}${missing.length && changed.length ? '; ' : ''}${changed.length ? `${changed.length} requirement(s) changed since the lockfile was generated (${changed.slice(0, 3).join(', ')})` : ''}.`,
          evidence: [id],
          fingerprint: `drift:${manifest.path}`,
          component: compName,
        });
      }
    }

    // Unpinned sources in the manifest itself.
    const unpinned = [...manifest.direct.entries()].filter(([, v]) => /^(latest|\*|x|)$/i.test(v.requirement.trim()) || /^(git\+|git:|github:|https?:\/\/)/.test(v.requirement));
    if (unpinned.length && manifest.ecosystem === 'npm') {
      findings.add({
        rule: 'REP-003',
        state: 'OBSERVED',
        summary: `${manifest.path} requests ${unpinned.length} dependenc${unpinned.length === 1 ? 'y' : 'ies'} by "latest", "*", a git reference or a URL (${unpinned.slice(0, 4).map(([n, v]) => `${n}@${v.requirement || '""'}`).join(', ')}).`,
        evidence: [],
        fingerprint: `unpinned:${manifest.path}`,
        component: compName,
      });
    }

    const source: ParsedDependency[] = lock
      ? lock.deps
      : [...manifest.direct.entries()].map(([name, v]) => ({ name, version: /^=?=?\s*v?\d+\.\d+\.\d+$/.test(v.requirement) ? v.requirement.replace(/^[=v\s]+/, '') : null, requirement: v.requirement, direct: true, scope: v.scope, sourceKind: 'registry' as const }));
    if (lock && seenLockForComponent.has(lockPath!) && !isSelfLock) {
      // A workspace lockfile shared by several manifests: attribute its packages once, to the first component.
      component.dependencyCount.transitive = 0;
      continue;
    }
    if (lockPath) seenLockForComponent.add(lockPath);

    const directSeen = new Set<string>();
    for (const d of source) {
      const n = normName(manifest.ecosystem, d.name);
      const declared = manifest.direct.get(d.name) ?? manifest.direct.get(n);
      const isDirect = d.direct || (!!declared && !directSeen.has(n));
      if (isDirect) directSeen.add(n);
      let scope: DependencyScope = d.scope;
      if (declared && (scope === 'unknown' || isDirect)) scope = declared.scope;
      const isPrivate = privatePackage(manifest.ecosystem, d, npmrc.privateScopes, ctx.declarations?.company.domains ?? []) || looksInternal(d.name, companyTokens);
      const evId = evidence.add({
        kind: lock ? 'lockfile.entry' : 'manifest.entry',
        detector: 'dependencies.parse@1',
        state: 'OBSERVED',
        locator: { path: lock ? lockPath! : manifest.path, ...(d.line ? { line: d.line } : {}) },
        extract: `${d.name}@${d.version ?? d.requirement ?? '?'}`,
        attributes: { ecosystem: manifest.ecosystem, scope, direct: isDirect },
      });
      const dep: Dependency = {
        id: stableId('dep', ctx.repoName, manifest.path, manifest.ecosystem, d.name, d.version ?? d.requirement ?? ''),
        ecosystem: manifest.ecosystem,
        name: d.name,
        version: d.version,
        direct: isDirect,
        scope,
        component: compName,
        repository: ctx.repoName,
        source: lock ? 'lockfile' : 'manifest',
        sourcePath: lock ? lockPath! : manifest.path,
        private: isPrivate,
        evidence: [evId],
      };
      if (declared) dep.requirement = declared.requirement;
      else if (d.requirement) dep.requirement = d.requirement;
      if (d.resolved) dep.resolved = redact(d.resolved);
      if (d.integrity) dep.integrity = d.integrity.slice(0, 120);
      if (d.hasInstallScript) dep.hasInstallScript = true;
      dep.license = licenseFromMetadata(d, manifest.ecosystem, vendoredLicense, evidence, lock ? lockPath! : manifest.path);
      dependencies.push(dep);
    }
    component.dependencyCount.transitive = source.filter((d) => !manifest.direct.has(d.name) && !manifest.direct.has(normName(manifest.ecosystem, d.name))).length;
  }

  // Dependencies that exist only as vendored copies (no manifest/lock mentions them).
  for (const [pkgDir, files] of vendoredPackages) {
    if (pkgDir.includes('node_modules/')) continue; // node_modules mirrors the lockfile
    const licFile = files.find((p) => dirname(p) === pkgDir && isLicenseFileName(basename(p)));
    const lt = licFile ? text(licFile) : undefined;
    const ident = lt ? identifyLicenseText(lt) : null;
    const ev = evidence.add({ kind: 'vendored.package', detector: 'dependencies.vendored@1', state: 'OBSERVED', locator: { path: pkgDir }, attributes: { files: files.length } });
    const expr = ident?.id ?? null;
    dependencies.push({
      id: stableId('dep', ctx.repoName, pkgDir, 'vendored'),
      ecosystem: 'vendored',
      name: pkgDir,
      version: null,
      direct: true,
      scope: 'unknown',
      component: 'vendored',
      repository: ctx.repoName,
      source: 'vendored',
      sourcePath: pkgDir,
      private: false,
      evidence: [ev],
      license: {
        expression: expr,
        certainty: ident?.certainty ?? 'UNKNOWN',
        state: expr ? (ident?.certainty === 'KNOWN' ? 'OBSERVED' : 'INFERRED') : 'UNKNOWN',
        categories: expr ? effectiveCategories(normalizeLicense(expr).node) : ['unknown'],
        source: expr ? 'license_file' : 'none',
        evidence: licFile ? [evidence.add({ kind: 'vendored.license_file', detector: 'licenses.vendored@1', state: 'OBSERVED', locator: { path: licFile }, extract: expr ?? 'unidentified license text', attributes: { certainty: ident?.certainty ?? 'UNKNOWN' } })] : [],
      },
    });
  }

  supplyChainChecks(ctx, dependencies);

  if (privateIndexes.length) {
    unknowns.add('security', 'Packages served from private indexes', `Private package indexes are configured (${privateIndexes.slice(0, 2).join('; ')}); their packages were not sent to any external service.`, 'Provide an SBOM or license list for private packages.', false);
  }

  return { components, dependencies: sortBy(dependencies, (d) => d.component, (d) => d.name, (d) => d.version ?? ''), manifests: manifests.sort(), lockfiles: [...new Set(lockfiles)].sort() };
}

function normName(ecosystem: string, name: string): string {
  return ecosystem === 'PyPI' ? pyName(name) : ecosystem === 'crates.io' ? name.replace(/_/g, '-') : name;
}

function relativeImporter(lockPath: string, manifestPath: string): string {
  const lockDir = dirname(lockPath);
  const manDir = dirname(manifestPath);
  if (lockDir === manDir) return lockDir === '' ? '' : '';
  const rel = lockDir ? manDir.slice(lockDir.length + 1) : manDir;
  return rel;
}

function vendoredPackageDir(path: string, root: string): string | null {
  const rest = path.slice(root.length + 1).split('/');
  if (rest.length < 2) return null;
  if (root.endsWith('node_modules')) {
    if (rest[0]!.startsWith('@')) return rest.length >= 3 ? `${root}/${rest[0]}/${rest[1]}` : null;
    return `${root}/${rest[0]}`;
  }
  if (/\./.test(rest[0]!) && rest.length >= 4) return `${root}/${rest[0]}/${rest[1]}/${rest[2]}`; // vendor/github.com/org/repo
  return `${root}/${rest[0]}`;
}

function looksInternal(name: string, tokens: string[]): boolean {
  const n = name.toLowerCase();
  return tokens.some((t) => n === t || n.startsWith(`${t}-`) || n.startsWith(`@${t}/`) || n.includes(`-${t}-`) || n.endsWith(`-${t}`));
}

function privatePackage(ecosystem: string, d: ParsedDependency, privateScopes: string[], companyDomains: string[]): boolean {
  if (d.sourceKind === 'path' || d.sourceKind === 'workspace') return true;
  if (ecosystem === 'npm') {
    const scope = d.name.startsWith('@') ? d.name.split('/')[0]!.toLowerCase() : null;
    if (scope && privateScopes.includes(scope)) return true;
    if (d.resolved && /^https?:\/\//.test(d.resolved) && !PUBLIC_HOSTS.test(d.resolved)) return true;
  }
  if (ecosystem === 'Go') {
    const host = d.name.split('/')[0]!.toLowerCase();
    if (companyDomains.some((dom) => host === dom || host.endsWith(`.${dom}`))) return true;
  }
  if (d.resolved && /^https?:\/\//.test(d.resolved) && !PUBLIC_HOSTS.test(d.resolved) && ecosystem !== 'Go') return true;
  return false;
}

function licenseFromMetadata(
  d: ParsedDependency,
  ecosystem: string,
  vendored: Map<string, { license: string | null; evidence: string; state: ProvenanceState }>,
  evidence: RepoContext['evidence'],
  sourcePath: string,
): LicenseConclusion {
  let raw: string | null = d.license ?? null;
  let src: LicenseConclusion['source'] = raw ? 'lockfile' : 'none';
  const ev: string[] = [];
  if (raw) {
    ev.push(evidence.add({ kind: 'lockfile.license', detector: 'licenses.metadata@1', state: 'OBSERVED', locator: { path: sourcePath }, extract: `${d.name}: ${raw}`, attributes: {} }));
  } else {
    const v = vendored.get(`${ecosystem}:${d.name}`);
    if (v?.license) {
      raw = v.license;
      src = 'license_file';
      if (v.evidence) ev.push(v.evidence);
    }
  }
  const norm = normalizeLicense(raw);
  if (!raw || (!norm.expression && !norm.seeFile)) {
    return { expression: null, certainty: 'UNKNOWN', state: 'UNKNOWN', categories: ['unknown'], source: 'none', evidence: [] };
  }
  if (norm.seeFile) {
    return { expression: `SEE LICENSE IN ${norm.seeFile}`, certainty: 'UNKNOWN', state: 'OBSERVED', categories: ['unknown'], source: src, evidence: ev };
  }
  if (norm.proprietary) {
    return { expression: norm.expression, certainty: 'KNOWN', state: 'OBSERVED', categories: ['proprietary'], source: src, evidence: ev };
  }
  const unrecognised = norm.expression!.startsWith('LicenseRef-Unrecognised');
  return {
    expression: norm.expression,
    certainty: unrecognised ? 'UNKNOWN' : norm.exact ? 'KNOWN' : 'LIKELY',
    state: unrecognised ? 'OBSERVED' : norm.exact ? 'OBSERVED' : 'INFERRED',
    categories: unrecognised ? ['unknown'] : effectiveCategories(norm.node),
    source: src,
    evidence: ev,
  };
}

function supplyChainChecks(ctx: RepoContext, deps: Dependency[]): void {
  const { findings, evidence } = ctx;
  const prod = deps.filter((d) => d.scope === 'production' || d.scope === 'unknown');

  const installers = prod.filter((d) => d.hasInstallScript);
  if (installers.length) {
    findings.add({
      rule: 'SEC-030',
      state: 'OBSERVED',
      summary: `${installers.length} production dependenc${installers.length === 1 ? 'y runs' : 'ies run'} install scripts (${installers.slice(0, 6).map((d) => `${d.name}@${d.version}`).join(', ')}).`,
      evidence: installers.slice(0, 40).flatMap((d) => d.evidence),
      fingerprint: 'install-scripts',
    });
  }

  const insecure = deps.filter((d) => d.resolved && /^http:\/\//i.test(d.resolved));
  if (insecure.length) {
    findings.add({
      rule: 'SEC-031',
      state: 'OBSERVED',
      summary: `${insecure.length} dependenc${insecure.length === 1 ? 'y is' : 'ies are'} fetched over plain HTTP (${insecure.slice(0, 4).map((d) => d.name).join(', ')}).`,
      evidence: insecure.slice(0, 40).flatMap((d) => d.evidence),
      fingerprint: 'http',
    });
  }

  const checkIntegrity = deps.filter((d) => d.source === 'lockfile' && ['npm', 'crates.io'].includes(d.ecosystem) && (d.resolved === undefined || !/^(file|link|workspace):/.test(d.resolved ?? '')));
  const noIntegrity = checkIntegrity.filter((d) => !d.integrity && !d.private);
  if (noIntegrity.length) {
    findings.add({
      rule: 'SEC-032',
      state: 'OBSERVED',
      summary: `${noIntegrity.length} lockfile entr${noIntegrity.length === 1 ? 'y has' : 'ies have'} no integrity hash (e.g. ${noIntegrity.slice(0, 4).map((d) => d.name).join(', ')}).`,
      evidence: noIntegrity.slice(0, 40).flatMap((d) => d.evidence),
      fingerprint: 'integrity',
    });
  }

  const unpinnedGit = deps.filter((d) => d.resolved && /^(git\+|git:|github:)|\.git(#|$)/.test(d.resolved) && !/#[0-9a-f]{40}$/.test(d.resolved));
  if (unpinnedGit.length) {
    findings.add({
      rule: 'REP-003',
      state: 'OBSERVED',
      summary: `${unpinnedGit.length} dependenc${unpinnedGit.length === 1 ? 'y comes' : 'ies come'} from git without a pinned commit (${unpinnedGit.slice(0, 4).map((d) => d.name).join(', ')}).`,
      evidence: unpinnedGit.slice(0, 40).flatMap((d) => d.evidence),
      fingerprint: 'git-unpinned',
    });
  }

  // Unscoped npm packages resolved from a private registry: the same name can be published publicly.
  const confusable = deps.filter((d) => d.ecosystem === 'npm' && d.private && !d.name.startsWith('@') && d.resolved && /^https?:/.test(d.resolved));
  if (confusable.length) {
    findings.add({
      rule: 'SEC-033',
      state: 'INFERRED',
      summary: `${confusable.length} unscoped package(s) resolve from a private registry (${confusable.slice(0, 4).map((d) => d.name).join(', ')}). If the same names are claimed on the public registry, a misconfigured install can fetch the public package instead.`,
      evidence: confusable.slice(0, 40).flatMap((d) => d.evidence),
      fingerprint: 'confusion-npm',
    });
  }

  // Near-miss names of popular packages (typosquatting signal).
  const suspicious: Dependency[] = [];
  for (const d of deps.filter((x) => x.direct && !x.private)) {
    const list = POPULAR[d.ecosystem];
    if (!list || list.has(d.name) || d.name.length < 5) continue;
    for (const p of list) {
      if (Math.abs(p.length - d.name.length) > 1) continue;
      if (editDistance(p, d.name) === 1) {
        suspicious.push(d);
        evidence.add({ kind: 'dependency.near_miss', detector: 'supplychain.typosquat@1', state: 'INFERRED', evidenceClass: 'INFERENCE', locator: { path: d.sourcePath }, extract: `${d.name} ≈ ${p}`, attributes: {} });
        break;
      }
    }
  }
  if (suspicious.length) {
    findings.add({
      rule: 'SEC-034',
      state: 'INFERRED',
      summary: `${suspicious.length} direct dependenc${suspicious.length === 1 ? 'y has a name' : 'ies have names'} one character away from a popular package (${suspicious.slice(0, 4).map((d) => d.name).join(', ')}). Confirm they are the intended packages.`,
      evidence: suspicious.flatMap((d) => d.evidence),
      fingerprint: 'typosquat',
    });
  }
}

function redact(url: string): string {
  return url.replace(/\/\/[^@/\s]+@/, '//').replace(/([?&](token|auth|key|password)=)[^&\s]+/gi, '$1***');
}
