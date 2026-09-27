import type { LicenseCategory } from '../model.js';

/** Category for well-known SPDX identifiers. Anything absent is 'unknown'. */
const CATEGORY: Record<string, LicenseCategory> = {};
const add = (cat: LicenseCategory, ids: string[]) => ids.forEach((id) => (CATEGORY[id.toLowerCase()] = cat));

add('permissive', [
  'MIT', 'MIT-0', 'Apache-2.0', 'Apache-1.1', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause', '0BSD', 'ISC',
  'Zlib', 'Python-2.0', 'PSF-2.0', 'BSL-1.0', 'Unicode-DFS-2016', 'Unicode-3.0', 'X11', 'PostgreSQL', 'NCSA', 'Artistic-2.0',
  'BlueOak-1.0.0', 'UPL-1.0', 'W3C', 'AFL-3.0', 'curl', 'OpenSSL', 'MS-PL', 'Ruby', 'HPND', 'libpng-2.0', 'bzip2-1.0.6', 'Beerware',
  'CC-BY-3.0', 'CC-BY-4.0', 'OFL-1.1', 'ImageMagick', 'Info-ZIP', 'MirOS', 'MulanPSL-2.0', 'Zlib-acknowledgement', 'FSFAP',
]);
add('public_domain', ['CC0-1.0', 'Unlicense', 'WTFPL', 'CC-PDDC', 'blessing']);
add('weak_copyleft', [
  'LGPL-2.0', 'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only',
  'LGPL-3.0-or-later', 'MPL-1.0', 'MPL-1.1', 'MPL-2.0', 'MPL-2.0-no-copyleft-exception', 'EPL-1.0', 'EPL-2.0', 'CDDL-1.0', 'CDDL-1.1', 'CPL-1.0',
  'MS-RL', 'IPL-1.0', 'APSL-2.0', 'CECILL-C',
]);
add('strong_copyleft', [
  'GPL-1.0', 'GPL-1.0-only', 'GPL-1.0-or-later', 'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'EUPL-1.1', 'EUPL-1.2', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'CC-BY-SA-2.0', 'CECILL-2.1', 'Sleepycat',
]);
add('network_copyleft', ['AGPL-1.0', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'OSL-3.0', 'RPL-1.5']);
add('source_available', [
  'BUSL-1.1', 'SSPL-1.0', 'Elastic-2.0', 'Commons-Clause', 'PolyForm-Noncommercial-1.0.0', 'PolyForm-Small-Business-1.0.0',
  'PolyForm-Shield-1.0.0', 'PolyForm-Perimeter-1.0.0', 'PolyForm-Internal-Use-1.0.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-3.0',
  'CC-BY-ND-4.0', 'CC-BY-NC-ND-4.0', 'JSON', 'Confluent-Community-1.0', 'LicenseRef-Commons-Clause', 'Hippocratic-2.1',
]);

export function categoryOf(id: string): LicenseCategory {
  const clean = id.replace(/\+$/, '').toLowerCase();
  if (clean.startsWith('licenseref-proprietary') || clean === 'unlicensed' || clean === 'proprietary') return 'proprietary';
  return CATEGORY[clean] ?? 'unknown';
}

export function isKnownSpdx(id: string): boolean {
  return CATEGORY[id.replace(/\+$/, '').toLowerCase()] !== undefined;
}

const RESTRICTIVENESS: Record<LicenseCategory, number> = {
  public_domain: 0,
  permissive: 1,
  content: 2,
  weak_copyleft: 3,
  strong_copyleft: 4,
  network_copyleft: 5,
  source_available: 6,
  proprietary: 7,
  unknown: 8,
};

/** Canonical casing of known SPDX ids. */
const CANONICAL = new Map<string, string>();
for (const id of Object.keys(CATEGORY)) CANONICAL.set(id, id);
const ORIGINAL_IDS = [
  'MIT', 'MIT-0', 'Apache-2.0', 'Apache-1.1', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause', '0BSD', 'ISC', 'Zlib',
  'Python-2.0', 'PSF-2.0', 'BSL-1.0', 'Unicode-DFS-2016', 'Unicode-3.0', 'X11', 'PostgreSQL', 'NCSA', 'Artistic-2.0', 'BlueOak-1.0.0',
  'UPL-1.0', 'W3C', 'AFL-3.0', 'curl', 'OpenSSL', 'MS-PL', 'Ruby', 'HPND', 'CC-BY-3.0', 'CC-BY-4.0', 'OFL-1.1', 'CC0-1.0', 'Unlicense',
  'WTFPL', 'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'LGPL-2.0',
  'LGPL-2.1', 'LGPL-3.0', 'MPL-1.0', 'MPL-1.1', 'MPL-2.0', 'EPL-1.0', 'EPL-2.0', 'CDDL-1.0', 'CDDL-1.1', 'CPL-1.0', 'MS-RL', 'GPL-2.0-only',
  'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'GPL-2.0', 'GPL-3.0', 'GPL-1.0', 'EUPL-1.1', 'EUPL-1.2', 'CC-BY-SA-3.0',
  'CC-BY-SA-4.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'AGPL-3.0', 'AGPL-1.0', 'OSL-3.0', 'RPL-1.5', 'BUSL-1.1', 'SSPL-1.0', 'Elastic-2.0',
  'Commons-Clause', 'PolyForm-Noncommercial-1.0.0', 'PolyForm-Small-Business-1.0.0', 'PolyForm-Shield-1.0.0', 'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0', 'CC-BY-ND-4.0', 'CC-BY-NC-ND-4.0', 'JSON', 'MulanPSL-2.0', 'Sleepycat',
];
for (const id of ORIGINAL_IDS) CANONICAL.set(id.toLowerCase(), id);

/** Common non-SPDX spellings found in package metadata. Mapping them is an inference. */
const ALIASES: Record<string, string> = {
  'apache 2.0': 'Apache-2.0', 'apache-2': 'Apache-2.0', 'apache2': 'Apache-2.0', 'apache license 2.0': 'Apache-2.0',
  'apache license, version 2.0': 'Apache-2.0', 'apache software license': 'Apache-2.0', 'asl 2.0': 'Apache-2.0', 'apache': 'Apache-2.0',
  'mit license': 'MIT', 'the mit license': 'MIT', 'expat': 'MIT', 'bsd': 'BSD-3-Clause', 'bsd license': 'BSD-3-Clause', 'new bsd': 'BSD-3-Clause',
  'bsd-3': 'BSD-3-Clause', 'simplified bsd': 'BSD-2-Clause', 'bsd-2': 'BSD-2-Clause', 'isc license': 'ISC',
  'gplv2': 'GPL-2.0-only', 'gpl-2': 'GPL-2.0-only', 'gpl v2': 'GPL-2.0-only', 'gplv3': 'GPL-3.0-only', 'gpl-3': 'GPL-3.0-only', 'gpl v3': 'GPL-3.0-only',
  'gpl': 'GPL-3.0-or-later', 'lgpl': 'LGPL-3.0-or-later', 'lgplv3': 'LGPL-3.0-only', 'lgplv2.1': 'LGPL-2.1-only', 'lgpl-2.1': 'LGPL-2.1-only',
  'agplv3': 'AGPL-3.0-only', 'agpl': 'AGPL-3.0-only', 'agpl-3': 'AGPL-3.0-only', 'mpl 2.0': 'MPL-2.0', 'mpl-2': 'MPL-2.0', 'mpl2': 'MPL-2.0',
  'mozilla public license 2.0': 'MPL-2.0', 'eclipse public license 2.0': 'EPL-2.0', 'epl 2.0': 'EPL-2.0', 'psf': 'PSF-2.0',
  'python software foundation license': 'PSF-2.0', 'public domain': 'CC-PDDC', 'cc0': 'CC0-1.0', 'the unlicense': 'Unlicense',
  'boost': 'BSL-1.0', 'boost software license': 'BSL-1.0', 'bsl': 'BSL-1.0', 'zlib license': 'Zlib', 'business source license': 'BUSL-1.1',
  'sspl': 'SSPL-1.0', 'elastic license 2.0': 'Elastic-2.0', 'elv2': 'Elastic-2.0', 'wtfpl': 'WTFPL', 'artistic-2': 'Artistic-2.0',
  'dual license': '', 'unknown': '', 'other': '', 'custom': '', 'none': '',
};

export type SpdxNode =
  | { type: 'license'; id: string; plus: boolean; exception?: string; known: boolean }
  | { type: 'and' | 'or'; left: SpdxNode; right: SpdxNode };

export interface NormalizedLicense {
  expression: string | null;
  /** True when the input was already a valid SPDX expression of known identifiers. */
  exact: boolean;
  node: SpdxNode | null;
  proprietary: boolean;
  seeFile: string | null;
}

/** Parse and normalise a license string from package metadata. */
export function normalizeLicense(input: string | null | undefined): NormalizedLicense {
  const none: NormalizedLicense = { expression: null, exact: false, node: null, proprietary: false, seeFile: null };
  if (!input) return none;
  const raw = input.trim().slice(0, 300);
  if (!raw) return none;
  const upper = raw.toUpperCase();
  if (upper === 'UNLICENSED' || upper === 'PROPRIETARY' || upper === 'COMMERCIAL' || /^LICENSEREF-PROPRIETARY/i.test(raw)) {
    return { expression: 'LicenseRef-Proprietary', exact: upper === 'UNLICENSED', node: null, proprietary: true, seeFile: null };
  }
  const see = /^SEE LICEN[CS]E IN (.+)$/i.exec(raw);
  if (see) return { ...none, seeFile: see[1]!.trim() };
  const parsed = parseExpression(raw);
  if (parsed && allKnown(parsed)) return { expression: render(parsed), exact: true, node: parsed, proprietary: false, seeFile: null };
  const alias = ALIASES[raw.toLowerCase().replace(/\s+/g, ' ')];
  if (alias !== undefined) {
    if (!alias) return none;
    const node = parseExpression(alias);
    return { expression: alias, exact: false, node, proprietary: false, seeFile: null };
  }
  // Split things like "MIT/Apache-2.0" or "MIT, Apache-2.0" (conventionally a choice).
  const parts = raw.split(/\s*(?:\/|,|\bor\b)\s*/i).filter(Boolean);
  if (parts.length > 1) {
    const ids = parts.map((p) => canonical(p) ?? ALIASES[p.toLowerCase()] ?? null);
    if (ids.every((x) => x)) {
      const expr = ids.join(' OR ');
      return { expression: expr, exact: false, node: parseExpression(expr), proprietary: false, seeFile: null };
    }
  }
  if (parsed) return { expression: render(parsed), exact: false, node: parsed, proprietary: false, seeFile: null };
  return { expression: `LicenseRef-Unrecognised(${raw.replace(/[()]/g, '')})`, exact: false, node: null, proprietary: false, seeFile: null };
}

function canonical(id: string): string | null {
  const bare = id.replace(/\+$/, '');
  const c = CANONICAL.get(bare.toLowerCase());
  return c ? c + (id.endsWith('+') ? '+' : '') : null;
}

function allKnown(n: SpdxNode): boolean {
  return n.type === 'license' ? n.known : allKnown(n.left) && allKnown(n.right);
}

/** Minimal SPDX expression parser: AND binds tighter than OR; WITH attaches an exception. */
export function parseExpression(input: string): SpdxNode | null {
  const tokens = input.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 200) return null;
  let i = 0;
  const peek = () => tokens[i];
  const parseAtom = (): SpdxNode | null => {
    const t = tokens[i++];
    if (!t) return null;
    if (t === '(') {
      const inner = parseOr();
      if (tokens[i++] !== ')') return null;
      return inner;
    }
    if (/^(AND|OR|WITH|\))$/i.test(t)) return null;
    if (!/^[A-Za-z0-9.+-]+(:[A-Za-z0-9.+-]+)?$/.test(t)) return null;
    const plus = t.endsWith('+');
    const c = canonical(t);
    const node: SpdxNode = { type: 'license', id: c ? c.replace(/\+$/, '') : t.replace(/\+$/, ''), plus, known: !!c || /^LicenseRef-/i.test(t) };
    if (peek()?.toUpperCase() === 'WITH') {
      i++;
      const ex = tokens[i++];
      if (!ex) return null;
      node.exception = ex;
    }
    return node;
  };
  const parseAnd = (): SpdxNode | null => {
    let left = parseAtom();
    while (left && peek()?.toUpperCase() === 'AND') {
      i++;
      const right = parseAtom();
      if (!right) return null;
      left = { type: 'and', left, right };
    }
    return left;
  };
  const parseOr = (): SpdxNode | null => {
    let left = parseAnd();
    while (left && peek()?.toUpperCase() === 'OR') {
      i++;
      const right = parseAnd();
      if (!right) return null;
      left = { type: 'or', left, right };
    }
    return left;
  };
  const result = parseOr();
  return result && i === tokens.length ? result : null;
}

export function render(n: SpdxNode, parent?: 'and' | 'or'): string {
  if (n.type === 'license') return `${n.id}${n.plus ? '+' : ''}${n.exception ? ` WITH ${n.exception}` : ''}`;
  const s = `${render(n.left, n.type)} ${n.type.toUpperCase()} ${render(n.right, n.type)}`;
  return parent && parent !== n.type ? `(${s})` : s;
}

/**
 * Categories that apply to a licensee. For OR the least restrictive branch is
 * available (a choice); for AND every branch applies.
 */
export function effectiveCategories(n: SpdxNode | null): LicenseCategory[] {
  if (!n) return ['unknown'];
  if (n.type === 'license') {
    const cat = categoryOf(n.id);
    // GCC/Classpath style exceptions relax linking obligations.
    if (n.exception && /classpath|gcc|llvm|linking|autoconf|bison/i.test(n.exception) && cat === 'strong_copyleft') return ['weak_copyleft'];
    return [cat];
  }
  if (n.type === 'and') return [...new Set([...effectiveCategories(n.left), ...effectiveCategories(n.right)])].sort();
  const l = effectiveCategories(n.left);
  const r = effectiveCategories(n.right);
  const worst = (cats: LicenseCategory[]) => Math.max(...cats.map((c) => RESTRICTIVENESS[c]));
  return worst(l) <= worst(r) ? l : r;
}

export function mostRestrictive(cats: LicenseCategory[]): LicenseCategory {
  let best: LicenseCategory = 'public_domain';
  for (const c of cats) if (RESTRICTIVENESS[c] > RESTRICTIVENESS[best]) best = c;
  return cats.length ? best : 'unknown';
}
