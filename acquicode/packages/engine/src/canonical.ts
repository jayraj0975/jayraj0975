import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no whitespace,
 * `undefined` members dropped, non-finite numbers rejected. Two semantically
 * equal values always serialise to the same bytes, which is what makes dossier
 * digests reproducible.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value);
}

function serialise(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'bigint':
      throw new Error('canonicalJson: bigint is not supported');
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v) => (v === undefined ? 'null' : serialise(v))).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialise(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Content-addressed identifier: prefix + first 16 hex of sha256(canonical(parts)). */
export function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${sha256Hex(canonicalJson(parts)).slice(0, 16)}`;
}

/** Deterministic comparison for sorting strings independent of locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortBy<T>(items: T[], ...keys: Array<(item: T) => string | number>): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b);
      if (typeof ka === 'number' && typeof kb === 'number') {
        if (ka !== kb) return ka - kb;
      } else {
        const c = compareStrings(String(ka), String(kb));
        if (c !== 0) return c;
      }
    }
    return 0;
  });
}
