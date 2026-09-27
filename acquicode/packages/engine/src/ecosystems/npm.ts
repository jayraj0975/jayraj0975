import YAML from 'yaml';
import type { DependencyScope } from '../model.js';
import type { LockInfo, ManifestInfo, ParsedDependency } from './types.js';

const SCOPES: Array<[string, DependencyScope]> = [
  ['dependencies', 'production'],
  ['optionalDependencies', 'optional'],
  ['peerDependencies', 'peer'],
  ['devDependencies', 'development'],
];

export function parsePackageJson(path: string, text: string): ManifestInfo | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const direct = new Map<string, { requirement: string; scope: DependencyScope }>();
  for (const [field, scope] of SCOPES) {
    const deps = json[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, req] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof req !== 'string') continue;
      // A package listed in dependencies and peerDependencies is production.
      if (!direct.has(name) || scope === 'production') direct.set(name, { requirement: req, scope });
    }
  }
  const license = typeof json.license === 'string' ? json.license : json.license && typeof json.license === 'object' && typeof (json.license as { type?: unknown }).type === 'string' ? (json.license as { type: string }).type : undefined;
  let workspaces: string[] | undefined;
  if (Array.isArray(json.workspaces)) workspaces = json.workspaces.filter((w): w is string => typeof w === 'string');
  else if (json.workspaces && typeof json.workspaces === 'object' && Array.isArray((json.workspaces as { packages?: unknown }).packages)) {
    workspaces = ((json.workspaces as { packages: unknown[] }).packages).filter((w): w is string => typeof w === 'string');
  }
  const engines = json.engines && typeof json.engines === 'object' ? (json.engines as Record<string, unknown>).node : undefined;
  const scripts: Record<string, string> = {};
  if (json.scripts && typeof json.scripts === 'object') {
    for (const [k, v] of Object.entries(json.scripts as Record<string, unknown>)) if (typeof v === 'string') scripts[k] = v;
  }
  const info: ManifestInfo = {
    ecosystem: 'npm',
    name: typeof json.name === 'string' ? json.name : path,
    path,
    direct,
    private: json.private === true,
    toolchain: typeof engines === 'string' ? engines : null,
    scripts,
  };
  if (license) info.license = license;
  if (workspaces) info.workspaces = workspaces;
  return info;
}

/** npm package-lock.json / npm-shrinkwrap.json, lockfileVersion 1, 2 or 3. */
export function parsePackageLock(path: string, text: string): LockInfo | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const deps: ParsedDependency[] = [];
  const importers = new Map<string, Map<string, string>>();
  const packages = json.packages as Record<string, Record<string, unknown>> | undefined;
  if (packages && typeof packages === 'object') {
    for (const [key, entry] of Object.entries(packages)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!key.includes('node_modules/')) {
        // Workspace/root importer: record what it declares.
        const declared = new Map<string, string>();
        for (const f of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
          const d = entry[f];
          if (d && typeof d === 'object') for (const [n, r] of Object.entries(d as Record<string, unknown>)) if (typeof r === 'string') declared.set(n, r);
        }
        importers.set(key, declared);
        continue;
      }
      if (entry.link === true) continue;
      const name = typeof entry.name === 'string' ? entry.name : key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const nested = key.split('node_modules/').length - 1;
      const scope: DependencyScope = entry.dev === true || entry.devOptional === true ? 'development' : entry.optional === true ? 'optional' : entry.peer === true ? 'peer' : 'production';
      const resolved = typeof entry.resolved === 'string' ? entry.resolved : undefined;
      const dep: ParsedDependency = {
        name,
        version: typeof entry.version === 'string' ? entry.version : null,
        direct: nested === 1 && !key.slice(0, key.indexOf('node_modules/')).includes('/') ? true : false,
        scope,
        sourceKind: sourceKind(resolved, typeof entry.version === 'string' ? entry.version : ''),
      };
      if (resolved) dep.resolved = resolved;
      if (typeof entry.integrity === 'string') dep.integrity = entry.integrity;
      if (typeof entry.license === 'string') dep.license = entry.license;
      if (entry.hasInstallScript === true) dep.hasInstallScript = true;
      if (dep.sourceKind === 'git') dep.pinned = /#[0-9a-f]{40}$/.test(resolved ?? '');
      deps.push(dep);
    }
    return { ecosystem: 'npm', path, deps, importers, format: `package-lock v${String(json.lockfileVersion ?? '?')}` };
  }
  // lockfileVersion 1: nested "dependencies" tree.
  const walk = (tree: Record<string, Record<string, unknown>> | undefined, depth: number) => {
    if (!tree) return;
    for (const [name, entry] of Object.entries(tree)) {
      if (!entry || typeof entry !== 'object') continue;
      const resolved = typeof entry.resolved === 'string' ? entry.resolved : undefined;
      const version = typeof entry.version === 'string' ? entry.version : null;
      const dep: ParsedDependency = {
        name,
        version,
        direct: depth === 0,
        scope: entry.dev === true ? 'development' : entry.optional === true ? 'optional' : 'production',
        sourceKind: sourceKind(resolved, version ?? ''),
      };
      if (resolved) dep.resolved = resolved;
      if (typeof entry.integrity === 'string') dep.integrity = entry.integrity;
      deps.push(dep);
      walk(entry.dependencies as Record<string, Record<string, unknown>> | undefined, depth + 1);
    }
  };
  walk(json.dependencies as Record<string, Record<string, unknown>> | undefined, 0);
  return { ecosystem: 'npm', path, deps, importers, format: 'package-lock v1' };
}

function sourceKind(resolved: string | undefined, version: string): ParsedDependency['sourceKind'] {
  const v = resolved ?? version;
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(v) || /\.git(#|$)/.test(v)) return 'git';
  if (/^file:|^link:|^workspace:/.test(v)) return /^workspace:/.test(v) ? 'workspace' : 'path';
  if (resolved && /^https?:\/\//.test(resolved) && !/\/-\/[^/]+\.tgz$/.test(resolved)) return 'url';
  return 'registry';
}

/** Yarn classic (v1) lockfile: blocks keyed by "name@range, name@range:". */
export function parseYarnLock(path: string, text: string): LockInfo | null {
  if (/^__metadata:/m.test(text)) return parseYarnBerry(path, text);
  const deps: ParsedDependency[] = [];
  const blocks = text.split(/\n(?=\S)/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0]!;
    if (!header.endsWith(':') || header.startsWith('#')) continue;
    const specs = header.slice(0, -1).split(/,\s*/).map((s) => s.replace(/^"|"$/g, ''));
    const first = specs[0]!;
    const at = first.lastIndexOf('@');
    const name = at > 0 ? first.slice(0, at) : first;
    let version: string | null = null;
    let resolved: string | undefined;
    let integrity: string | undefined;
    for (const l of lines.slice(1)) {
      const m = /^\s+(version|resolved|integrity)\s+"?([^"]+)"?\s*$/.exec(l);
      if (!m) continue;
      if (m[1] === 'version') version = m[2]!;
      else if (m[1] === 'resolved') resolved = m[2]!;
      else integrity = m[2]!;
    }
    const dep: ParsedDependency = { name, version, requirement: specs.map((s) => s.slice(s.lastIndexOf('@') + 1)).join(', '), direct: false, scope: 'unknown', sourceKind: sourceKind(resolved, version ?? '') };
    if (resolved) dep.resolved = resolved;
    if (integrity) dep.integrity = integrity;
    deps.push(dep);
  }
  return { ecosystem: 'npm', path, deps, format: 'yarn v1' };
}

function parseYarnBerry(path: string, text: string): LockInfo | null {
  let doc: Record<string, Record<string, unknown>>;
  try {
    doc = YAML.parse(text, { maxAliasCount: 0 }) as Record<string, Record<string, unknown>>;
  } catch {
    return null;
  }
  const deps: ParsedDependency[] = [];
  for (const [key, entry] of Object.entries(doc ?? {})) {
    if (key === '__metadata' || !entry || typeof entry !== 'object') continue;
    const first = key.split(',')[0]!.trim();
    const at = first.indexOf('@', 1);
    const name = at > 0 ? first.slice(0, at) : first;
    const resolution = typeof entry.resolution === 'string' ? entry.resolution : '';
    if (/@workspace:/.test(resolution)) continue;
    const dep: ParsedDependency = {
      name,
      version: typeof entry.version === 'string' ? entry.version : null,
      direct: false,
      scope: 'unknown',
      sourceKind: /@(git|https?):/.test(resolution) ? (/@git/.test(resolution) ? 'git' : 'url') : /@(file|link|portal):/.test(resolution) ? 'path' : 'registry',
    };
    if (typeof entry.checksum === 'string') dep.integrity = entry.checksum;
    if (resolution) dep.resolved = resolution;
    deps.push(dep);
  }
  return { ecosystem: 'npm', path, deps, format: 'yarn berry' };
}

/** pnpm-lock.yaml (lockfileVersion 5.x, 6.x, 9.x). */
export function parsePnpmLock(path: string, text: string): LockInfo | null {
  let doc: Record<string, unknown>;
  try {
    doc = YAML.parse(text, { maxAliasCount: 0 }) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const deps: ParsedDependency[] = [];
  const importers = new Map<string, Map<string, string>>();
  const importerDoc = (doc.importers as Record<string, Record<string, unknown>> | undefined) ?? { '.': doc as Record<string, unknown> };
  const directProd = new Set<string>();
  const directDev = new Set<string>();
  for (const [dir, imp] of Object.entries(importerDoc)) {
    const declared = new Map<string, string>();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const d = imp?.[field];
      if (!d || typeof d !== 'object') continue;
      for (const [n, v] of Object.entries(d as Record<string, unknown>)) {
        const spec = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as { specifier?: unknown }).specifier ?? '') : '';
        declared.set(n, spec);
        const ver = v && typeof v === 'object' ? String((v as { version?: unknown }).version ?? '') : String(v);
        (field === 'devDependencies' ? directDev : directProd).add(`${n}@${ver.split('(')[0]}`);
      }
    }
    importers.set(dir, declared);
  }
  const packages = (doc.packages as Record<string, Record<string, unknown>> | undefined) ?? {};
  const snapshots = (doc.snapshots as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const [key, entry] of Object.entries(packages)) {
    const k = key.replace(/^\//, '').split('(')[0]!;
    // v5: /name/1.2.3 ; v6: /name@1.2.3 ; v9: name@1.2.3
    let name: string;
    let version: string;
    const at = k.lastIndexOf('@');
    if (at > 0 && !k.slice(at).includes('/')) {
      name = k.slice(0, at);
      version = k.slice(at + 1);
    } else {
      const slash = k.lastIndexOf('/');
      name = k.slice(0, slash);
      version = k.slice(slash + 1);
    }
    const resolution = (entry?.resolution ?? {}) as Record<string, unknown>;
    const snap = snapshots[key] ?? {};
    const isDev = entry?.dev === true || (directDev.has(`${name}@${version}`) && !directProd.has(`${name}@${version}`));
    const dep: ParsedDependency = {
      name,
      version,
      direct: directProd.has(`${name}@${version}`) || directDev.has(`${name}@${version}`),
      scope: entry?.dev === false ? 'production' : isDev ? 'development' : entry?.optional === true || snap.optional === true ? 'optional' : entry?.dev === undefined && !doc.importers ? 'production' : 'unknown',
      sourceKind: typeof resolution.tarball === 'string' ? 'url' : typeof resolution.repo === 'string' || resolution.type === 'git' ? 'git' : 'registry',
    };
    if (typeof resolution.integrity === 'string') dep.integrity = resolution.integrity;
    if (typeof resolution.tarball === 'string') dep.resolved = resolution.tarball;
    if (entry?.requiresBuild === true) dep.hasInstallScript = true;
    deps.push(dep);
  }
  return { ecosystem: 'npm', path, deps, importers, format: `pnpm v${String(doc.lockfileVersion ?? '?')}` };
}

/** Scopes routed to non-public registries by .npmrc (their packages are private). */
export function parseNpmrc(text: string): { privateScopes: string[]; defaultRegistry: string | null } {
  const privateScopes: string[] = [];
  let defaultRegistry: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const scoped = /^(@[a-z0-9-~][a-z0-9-._~]*):registry\s*=\s*(\S+)/i.exec(line);
    if (scoped && !/registry\.npmjs\.org/.test(scoped[2]!)) privateScopes.push(scoped[1]!.toLowerCase());
    const def = /^registry\s*=\s*(\S+)/i.exec(line);
    if (def) defaultRegistry = def[1]!;
  }
  return { privateScopes, defaultRegistry };
}
