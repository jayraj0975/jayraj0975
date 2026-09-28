/** Path and glob helpers. All paths are repository-relative with POSIX separators. */

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  if (p.includes('\0')) return false;
  return !p.split(/[\\/]/).some((seg) => seg === '..');
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
}

export function segments(p: string): string[] {
  return p.split('/').filter(Boolean);
}

const cache = new Map<string, RegExp>();

/**
 * Convert a glob to a RegExp. Supports `**` (any number of directories), `*`
 * (within a segment), `?`, and `[...]` classes. A pattern without a slash
 * matches a basename at any depth (gitattributes/gitignore semantics).
 */
export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let p = normalizePath(pattern.trim());
  let anchored = p.includes('/') && !p.startsWith('**/');
  if (p.startsWith('/')) {
    p = p.slice(1);
    anchored = true;
  }
  if (p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        const atSegStart = i === 0 || p[i - 1] === '/';
        const atSegEnd = i + 2 === p.length || p[i + 2] === '/';
        if (atSegStart && atSegEnd) {
          if (p[i + 2] === '/') {
            re += '(?:.*/)?';
            i += 2;
          } else {
            re += '.*';
            i += 1;
          }
          continue;
        }
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end < 0) {
        re += '\\[';
      } else {
        let cls = p.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        re += `[${cls}]`;
        i = end;
      }
    } else {
      re += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  const full = anchored ? `^${re}$` : `^(?:.*/)?${re}$`;
  const out = new RegExp(full);
  cache.set(pattern, out);
  return out;
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(path, p));
}
