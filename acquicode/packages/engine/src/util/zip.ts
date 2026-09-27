import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from 'fflate';
import { isSafeRelativePath, normalizePath } from './paths.js';

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  /** Maximum ratio of uncompressed to compressed size across the archive (zip-bomb guard). */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 200_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 512 * 1024 * 1024,
  maxRatio: 200,
};

export class ZipError extends Error {}

export interface ExtractResult {
  files: number;
  bytes: number;
  skipped: Array<{ path: string; reason: string }>;
  /** A single top-level directory wrapping everything (GitHub archive style) is stripped. */
  root: string;
}

/**
 * Extract an untrusted ZIP into `dest`. Rejects absolute paths and `..`
 * (zip-slip), never creates symlinks, and enforces entry-count, size and
 * compression-ratio limits while streaming (zip-bomb protection).
 */
export async function extractZipSafely(data: Uint8Array, dest: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ExtractResult> {
  const destRoot = resolve(dest);
  const pending: Array<{ path: string; chunks: Uint8Array[] }> = [];
  const skipped: ExtractResult['skipped'] = [];
  let entries = 0;
  let total = 0;
  let error: Error | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file: UnzipFile) => {
    if (error) return;
    entries++;
    if (entries > limits.maxEntries) {
      error = new ZipError(`archive has more than ${limits.maxEntries} entries`);
      return;
    }
    const name = normalizePath(file.name);
    if (name.endsWith('/')) return; // directory entry
    if (!isSafeRelativePath(name) || name.includes('\0')) {
      skipped.push({ path: file.name.slice(0, 200), reason: 'unsafe path' });
      return;
    }
    if (name.split('/').some((seg) => seg === '.git')) {
      skipped.push({ path: name, reason: '.git metadata is not extracted' });
      return;
    }
    // Unix mode bits live in the high 16 bits of the external attributes; 0o120000 is a symlink.
    const attrs = (file as unknown as { attrs?: number }).attrs;
    if (attrs !== undefined && ((attrs >>> 16) & 0o170000) === 0o120000) {
      skipped.push({ path: name, reason: 'symlink not extracted' });
      return;
    }
    const entry = { path: name, chunks: [] as Uint8Array[] };
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (error) return;
      if (err) {
        error = new ZipError(`corrupt entry ${name}: ${err.message}`);
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxEntryBytes) {
        error = new ZipError(`entry ${name} exceeds ${limits.maxEntryBytes} bytes`);
        return;
      }
      if (total > limits.maxTotalBytes) {
        error = new ZipError(`archive expands beyond ${limits.maxTotalBytes} bytes`);
        return;
      }
      if (total > 1024 * 1024 && total / Math.max(data.length, 1) > limits.maxRatio) {
        error = new ZipError('compression ratio is implausibly high (possible zip bomb)');
        return;
      }
      entry.chunks.push(chunk);
      if (final) pending.push(entry);
    };
    file.start();
  };
  try {
    const step = 1024 * 1024;
    for (let i = 0; i < data.length && !error; i += step) unzip.push(data.subarray(i, Math.min(i + step, data.length)), i + step >= data.length);
  } catch (err) {
    throw new ZipError(`not a valid ZIP archive: ${(err as Error).message}`);
  }
  if (error) throw error;
  if (entries === 0) throw new ZipError('archive is empty or not a ZIP file');

  // Strip a single wrapping directory (e.g. "repo-main/").
  const tops = new Set(pending.map((p) => p.path.split('/')[0]));
  const strip = tops.size === 1 && pending.every((p) => p.path.includes('/')) ? `${[...tops][0]}/` : '';
  let files = 0;
  for (const p of pending) {
    const rel = strip ? p.path.slice(strip.length) : p.path;
    if (!rel) continue;
    const target = resolve(join(destRoot, rel));
    if (!target.startsWith(destRoot + sep)) {
      skipped.push({ path: rel, reason: 'escapes destination' });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.concat(p.chunks), { mode: 0o644, flag: 'wx' }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code === 'EEXIST') skipped.push({ path: rel, reason: 'duplicate entry' });
      else throw err;
    });
    files++;
  }
  return { files, bytes: total, skipped, root: strip.replace(/\/$/, '') };
}
