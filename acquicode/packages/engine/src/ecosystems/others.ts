import { parse as parseToml } from 'smol-toml';
import type { DependencyScope } from '../model.js';
import type { LockInfo, ManifestInfo, ParsedDependency } from './types.js';

function safeToml(text: string): Record<string, unknown> | null {
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** PEP 503 normalised Python package name. */
export function pyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

// ------------------------------------------------------------------ Python

/** requirements*.txt: pins, ranges, hashes, VCS and URL requirements. */
export function parseRequirements(path: string, text: string): { manifest: ManifestInfo; lock: LockInfo | null } {
  const direct = new Map<string, { requirement: string; scope: DependencyScope; line?: number }>();
  const deps: ParsedDependency[] = [];
  const scope: DependencyScope = /dev|test|lint|doc/i.test(path) ? 'development' : 'production';
  let allPinned = true;
  let any = false;
  const lines = text.replace(/\\\n/g, ' ').split('\n');
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-r') || line.startsWith('-c') || line.startsWith('--')) return;
    any = true;
    const vcs = /^(-e\s+)?(git\+\S+|hg\+\S+|svn\+\S+)/.exec(line);
    if (vcs) {
      const url = vcs[2]!;
      const egg = /#egg=([A-Za-z0-9._-]+)/.exec(url);
      const name = egg ? pyName(egg[1]!) : url;
      direct.set(name, { requirement: url, scope, line: idx + 1 });
      deps.push({ name, version: null, requirement: url, direct: true, scope, sourceKind: 'git', pinned: /@[0-9a-f]{40}/.test(url), resolved: url, line: idx + 1 });
      allPinned = false;
      return;
    }
    const urlReq = /^([A-Za-z0-9._-]+)\s*@\s*(https?:\/\/\S+|file:\S+)/.exec(line);
    if (urlReq) {
      const name = pyName(urlReq[1]!);
      direct.set(name, { requirement: urlReq[2]!, scope, line: idx + 1 });
      deps.push({ name, version: null, requirement: urlReq[2]!, direct: true, scope, sourceKind: urlReq[2]!.startsWith('file:') ? 'path' : 'url', resolved: urlReq[2]!, line: idx + 1 });
      allPinned = false;
      return;
    }
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (!m) return;
    const name = pyName(m[1]!);
    const spec = m[3]!.split(';')[0]!.replace(/--hash=\S+/g, '').trim();
    const pin = /^===?\s*([A-Za-z0-9.+!_-]+)$/.exec(spec);
    direct.set(name, { requirement: spec || '*', scope, line: idx + 1 });
    const dep: ParsedDependency = { name, version: pin ? pin[1]! : null, requirement: spec || '*', direct: true, scope, sourceKind: 'registry', line: idx + 1 };
    if (/--hash=/.test(line)) dep.integrity = (/--hash=(\S+)/.exec(line) ?? [])[1] ?? '';
    deps.push(dep);
    if (!pin) allPinned = false;
  });
  const manifest: ManifestInfo = { ecosystem: 'PyPI', name: path, path, direct };
  // A fully pinned requirements file (pip-compile style) is its own lock.
  const lock = any && allPinned ? { ecosystem: 'PyPI', path, deps, format: 'pinned requirements' } : null;
  return { manifest, lock };
}

export function parsePyproject(path: string, text: string): ManifestInfo | null {
  const doc = safeToml(text);
  if (!doc) return null;
  const direct = new Map<string, { requirement: string; scope: DependencyScope }>();
  const project = (doc.project ?? {}) as Record<string, unknown>;
  const addPep508 = (spec: unknown, scope: DependencyScope) => {
    if (typeof spec !== 'string') return;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(spec.trim());
    if (m) direct.set(pyName(m[1]!), { requirement: m[3]!.split(';')[0]!.trim() || '*', scope });
  };
  for (const s of Array.isArray(project.dependencies) ? project.dependencies : []) addPep508(s, 'production');
  const optional = (project['optional-dependencies'] ?? {}) as Record<string, unknown>;
  for (const [group, list] of Object.entries(optional)) for (const s of Array.isArray(list) ? list : []) addPep508(s, /dev|test|lint|doc/i.test(group) ? 'development' : 'optional');
  const groups = (doc['dependency-groups'] ?? {}) as Record<string, unknown>;
  for (const list of Object.values(groups)) for (const s of Array.isArray(list) ? list : []) addPep508(s, 'development');
  const poetry = ((doc.tool as Record<string, unknown> | undefined)?.poetry ?? {}) as Record<string, unknown>;
  const addPoetry = (table: unknown, scope: DependencyScope) => {
    if (!table || typeof table !== 'object') return;
    for (const [n, v] of Object.entries(table as Record<string, unknown>)) {
      if (n.toLowerCase() === 'python') continue;
      const req = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as { version?: unknown; git?: unknown }).version ?? (v as { git?: unknown }).git ?? '*') : '*';
      direct.set(pyName(n), { requirement: req, scope });
    }
  };
  addPoetry(poetry.dependencies, 'production');
  addPoetry(poetry['dev-dependencies'], 'development');
  const pgroups = (poetry.group ?? {}) as Record<string, { dependencies?: unknown }>;
  for (const [g, def] of Object.entries(pgroups)) addPoetry(def?.dependencies, g === 'main' ? 'production' : 'development');
  let license: string | undefined;
  if (typeof project.license === 'string') license = project.license;
  else if (project.license && typeof project.license === 'object' && typeof (project.license as { text?: unknown }).text === 'string') license = (project.license as { text: string }).text;
  else if (typeof poetry.license === 'string') license = poetry.license;
  const info: ManifestInfo = {
    ecosystem: 'PyPI',
    name: typeof project.name === 'string' ? project.name : typeof poetry.name === 'string' ? poetry.name : path,
    path,
    direct,
    toolchain: typeof project['requires-python'] === 'string' ? project['requires-python'] : null,
  };
  if (license) info.license = license;
  return info;
}

/** poetry.lock, uv.lock and pdm.lock share the [[package]] name/version layout. */
export function parsePythonTomlLock(path: string, text: string): LockInfo | null {
  const doc = safeToml(text);
  if (!doc) return null;
  const deps: ParsedDependency[] = [];
  for (const p of Array.isArray(doc.package) ? (doc.package as Array<Record<string, unknown>>) : []) {
    if (typeof p.name !== 'string') continue;
    const source = (p.source ?? {}) as Record<string, unknown>;
    const category = typeof p.category === 'string' ? p.category : null;
    const groups = Array.isArray(p.groups) ? (p.groups as string[]) : null;
    const scope: DependencyScope = category === 'dev' || (groups && !groups.includes('main')) ? 'development' : category === 'main' || (groups && groups.includes('main')) ? 'production' : 'unknown';
    const isGit = typeof source.git === 'string' || source.type === 'git';
    const isVirtual = source.virtual !== undefined || source.editable !== undefined;
    if (isVirtual) continue;
    const dep: ParsedDependency = {
      name: pyName(p.name),
      version: typeof p.version === 'string' ? p.version : null,
      direct: false,
      scope,
      sourceKind: isGit ? 'git' : typeof source.url === 'string' && source.type !== 'legacy' ? 'url' : typeof source.path === 'string' || typeof source.directory === 'string' ? 'path' : 'registry',
    };
    if (isGit) {
      const ref = String(source.resolved_reference ?? source.git ?? '');
      dep.pinned = /[0-9a-f]{40}/.test(ref);
      dep.resolved = String(source.url ?? source.git ?? '');
    }
    const files = Array.isArray(p.files) ? p.files : Array.isArray(p.wheels) ? p.wheels : [];
    if (files.length || typeof (p.sdist as { hash?: unknown } | undefined)?.hash === 'string') dep.integrity = 'hashes';
    deps.push(dep);
  }
  return { ecosystem: 'PyPI', path, deps, format: path.endsWith('uv.lock') ? 'uv' : path.endsWith('pdm.lock') ? 'pdm' : 'poetry' };
}

export function parsePipfileLock(path: string, text: string): LockInfo | null {
  let json: Record<string, Record<string, Record<string, unknown>>>;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const deps: ParsedDependency[] = [];
  for (const [section, scope] of [['default', 'production'], ['develop', 'development']] as const) {
    for (const [name, entry] of Object.entries(json[section] ?? {})) {
      const version = typeof entry.version === 'string' ? entry.version.replace(/^==/, '') : null;
      const dep: ParsedDependency = { name: pyName(name), version, direct: false, scope, sourceKind: typeof entry.git === 'string' ? 'git' : 'registry' };
      if (Array.isArray(entry.hashes) && entry.hashes.length) dep.integrity = 'hashes';
      if (typeof entry.git === 'string') dep.pinned = typeof entry.ref === 'string' && /^[0-9a-f]{40}$/.test(entry.ref);
      deps.push(dep);
    }
  }
  return { ecosystem: 'PyPI', path, deps, format: 'Pipfile.lock' };
}

export function parsePipfile(path: string, text: string): ManifestInfo | null {
  const doc = safeToml(text);
  if (!doc) return null;
  const direct = new Map<string, { requirement: string; scope: DependencyScope }>();
  for (const [section, scope] of [['packages', 'production'], ['dev-packages', 'development']] as const) {
    for (const [n, v] of Object.entries((doc[section] ?? {}) as Record<string, unknown>)) {
      direct.set(pyName(n), { requirement: typeof v === 'string' ? v : '*', scope });
    }
  }
  return { ecosystem: 'PyPI', name: path, path, direct };
}

// ------------------------------------------------------------------ Go

export function parseGoMod(path: string, text: string): { manifest: ManifestInfo; lock: LockInfo } {
  const direct = new Map<string, { requirement: string; scope: DependencyScope; line?: number }>();
  const deps: ParsedDependency[] = [];
  const replaced = new Set<string>();
  let module = path;
  let goVersion: string | null = null;
  let inRequire = false;
  let inReplace = false;
  text.split('\n').forEach((raw, idx) => {
    const line = raw.replace(/\/\/(?! indirect).*$/, '').trim();
    const indirect = /\/\/\s*indirect/.test(raw);
    if (!line) return;
    if (line.startsWith('module ')) module = line.slice(7).trim();
    else if (line.startsWith('go ')) goVersion = line.slice(3).trim();
    else if (line.startsWith('require (')) inRequire = true;
    else if (line.startsWith('replace (')) inReplace = true;
    else if (line === ')') {
      inRequire = false;
      inReplace = false;
    } else if (inReplace || line.startsWith('replace ')) {
      const m = /^(?:replace\s+)?(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/.exec(line);
      if (m) replaced.add(m[1]!);
    } else if (inRequire || line.startsWith('require ')) {
      const m = /^(?:require\s+)?(\S+)\s+(v\S+)/.exec(line);
      if (!m) return;
      const name = m[1]!;
      const version = m[2]!;
      if (!indirect) direct.set(name, { requirement: version, scope: 'production', line: idx + 1 });
      deps.push({ name, version, requirement: version, direct: !indirect, scope: 'production', sourceKind: 'registry', line: idx + 1 });
    }
  });
  for (const d of deps) if (replaced.has(d.name)) d.sourceKind = 'path';
  return {
    manifest: { ecosystem: 'Go', name: module, path, direct, toolchain: goVersion },
    // go.mod lists exact module versions (minimal version selection): it is its own lock; go.sum carries hashes.
    lock: { ecosystem: 'Go', path, deps, format: 'go.mod' },
  };
}

// ------------------------------------------------------------------ Rust

export function parseCargoToml(path: string, text: string): ManifestInfo | null {
  const doc = safeToml(text);
  if (!doc) return null;
  const direct = new Map<string, { requirement: string; scope: DependencyScope }>();
  const add = (table: unknown, scope: DependencyScope) => {
    if (!table || typeof table !== 'object') return;
    for (const [n, v] of Object.entries(table as Record<string, unknown>)) {
      const req = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as { version?: unknown; git?: unknown; path?: unknown }).version ?? (v as { git?: unknown }).git ?? (v as { path?: unknown }).path ?? '*') : '*';
      const pkg = v && typeof v === 'object' && typeof (v as { package?: unknown }).package === 'string' ? (v as { package: string }).package : n;
      direct.set(pkg, { requirement: req, scope });
    }
  };
  add(doc.dependencies, 'production');
  add(doc['build-dependencies'], 'production');
  add(doc['dev-dependencies'], 'development');
  const pkg = (doc.package ?? {}) as Record<string, unknown>;
  const info: ManifestInfo = { ecosystem: 'crates.io', name: typeof pkg.name === 'string' ? pkg.name : path, path, direct, toolchain: typeof pkg['rust-version'] === 'string' ? pkg['rust-version'] : null };
  if (typeof pkg.license === 'string') info.license = pkg.license;
  const ws = (doc.workspace ?? {}) as Record<string, unknown>;
  if (Array.isArray(ws.members)) info.workspaces = ws.members.filter((m): m is string => typeof m === 'string');
  return info;
}

export function parseCargoLock(path: string, text: string): LockInfo | null {
  const doc = safeToml(text);
  if (!doc) return null;
  const deps: ParsedDependency[] = [];
  for (const p of Array.isArray(doc.package) ? (doc.package as Array<Record<string, unknown>>) : []) {
    if (typeof p.name !== 'string') continue;
    const source = typeof p.source === 'string' ? p.source : '';
    if (!source) continue; // workspace members
    const dep: ParsedDependency = {
      name: p.name,
      version: typeof p.version === 'string' ? p.version : null,
      direct: false,
      scope: 'unknown',
      sourceKind: source.startsWith('git+') ? 'git' : source.startsWith('registry+') || source.startsWith('sparse+') ? 'registry' : 'url',
    };
    if (source.startsWith('git+')) dep.pinned = /#[0-9a-f]{40}$/.test(source);
    if (typeof p.checksum === 'string') dep.integrity = p.checksum;
    dep.resolved = source;
    deps.push(dep);
  }
  return { ecosystem: 'crates.io', path, deps, format: 'Cargo.lock' };
}

// ------------------------------------------------------------------ Ruby

export function parseGemfileLock(path: string, text: string): LockInfo | null {
  const deps: ParsedDependency[] = [];
  const direct = new Set<string>();
  let section = '';
  for (const raw of text.split('\n')) {
    if (/^[A-Z]/.test(raw)) {
      section = raw.trim();
      continue;
    }
    if (section === 'DEPENDENCIES') {
      const m = /^\s{2}([A-Za-z0-9._-]+)/.exec(raw);
      if (m) direct.add(m[1]!);
      continue;
    }
    if (section === 'GEM' || section === 'GIT' || section === 'PATH') {
      const m = /^\s{4}([A-Za-z0-9._-]+) \(([^)]+)\)$/.exec(raw);
      if (m) deps.push({ name: m[1]!, version: m[2]!.split('-')[0]!, direct: false, scope: 'unknown', sourceKind: section === 'GEM' ? 'registry' : section === 'GIT' ? 'git' : 'path' });
    }
  }
  for (const d of deps) d.direct = direct.has(d.name);
  return { ecosystem: 'RubyGems', path, deps, format: 'Gemfile.lock' };
}

export function parseGemfile(path: string, text: string): ManifestInfo {
  const direct = new Map<string, { requirement: string; scope: DependencyScope }>();
  let group: DependencyScope = 'production';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^group\s+.*(:development|:test)/.test(line)) group = 'development';
    else if (line === 'end') group = 'production';
    const m = /^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/.exec(line);
    if (m) direct.set(m[1]!, { requirement: m[2] ?? '*', scope: group });
  }
  return { ecosystem: 'RubyGems', name: path, path, direct };
}

// ------------------------------------------------------------------ PHP

export function parseComposerJson(path: string, text: string): ManifestInfo | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const direct = new Map<string, { requirement: string; scope: DependencyScope }>();
  for (const [field, scope] of [['require', 'production'], ['require-dev', 'development']] as const) {
    for (const [n, v] of Object.entries((json[field] ?? {}) as Record<string, unknown>)) {
      if (n === 'php' || n.startsWith('ext-')) continue;
      direct.set(n, { requirement: String(v), scope });
    }
  }
  const info: ManifestInfo = { ecosystem: 'Packagist', name: typeof json.name === 'string' ? json.name : path, path, direct };
  if (typeof json.license === 'string') info.license = json.license;
  else if (Array.isArray(json.license)) info.license = (json.license as string[]).join(' OR ');
  return info;
}

export function parseComposerLock(path: string, text: string): LockInfo | null {
  let json: Record<string, Array<Record<string, unknown>>>;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const deps: ParsedDependency[] = [];
  for (const [field, scope] of [['packages', 'production'], ['packages-dev', 'development']] as const) {
    for (const p of json[field] ?? []) {
      if (typeof p.name !== 'string') continue;
      const dist = (p.dist ?? {}) as Record<string, unknown>;
      const dep: ParsedDependency = { name: p.name, version: typeof p.version === 'string' ? p.version.replace(/^v/, '') : null, direct: false, scope, sourceKind: 'registry' };
      if (Array.isArray(p.license)) dep.license = (p.license as string[]).join(' OR ');
      if (typeof dist.shasum === 'string' && dist.shasum) dep.integrity = dist.shasum;
      if (typeof dist.url === 'string') dep.resolved = dist.url;
      deps.push(dep);
    }
  }
  return { ecosystem: 'Packagist', path, deps, format: 'composer.lock' };
}

// ------------------------------------------------------------------ Maven

/** pom.xml: explicit <dependency> blocks. Property references are left unresolved (recorded as such). */
export function parsePom(path: string, text: string): { manifest: ManifestInfo; lock: LockInfo } {
  const direct = new Map<string, { requirement: string; scope: DependencyScope; line?: number }>();
  const deps: ParsedDependency[] = [];
  const noMgmt = text.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noMgmt))) {
    const body = m[1]!;
    const tag = (t: string) => (new RegExp(`<${t}>\\s*([^<]+?)\\s*</${t}>`).exec(body) ?? [])[1];
    const g = tag('groupId');
    const a = tag('artifactId');
    if (!g || !a) continue;
    const v = tag('version') ?? null;
    const s = tag('scope') ?? 'compile';
    const scope: DependencyScope = s === 'test' ? 'development' : s === 'provided' ? 'peer' : 'production';
    const name = `${g}:${a}`;
    const exact = v && !v.includes('${') && !/[[(,]/.test(v) ? v : null;
    direct.set(name, { requirement: v ?? '(managed)', scope });
    deps.push({ name, version: exact, requirement: v ?? '(managed)', direct: true, scope, sourceKind: 'registry' });
  }
  const artifact = (/<artifactId>([^<]+)<\/artifactId>/.exec(text.replace(/<parent>[\s\S]*?<\/parent>/, '')) ?? [])[1];
  return {
    manifest: { ecosystem: 'Maven', name: artifact ?? path, path, direct },
    lock: { ecosystem: 'Maven', path, deps, format: 'pom.xml (declared versions)' },
  };
}
