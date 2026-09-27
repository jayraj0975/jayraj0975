import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { GitRepo } from './git/repo.js';
import { catFileBatch } from './git/run.js';
import { normalizePath } from './util/paths.js';

export type EntryMode = 'file' | 'exec' | 'symlink' | 'submodule';

export interface SourceEntry {
  path: string;
  mode: EntryMode;
  size: number;
  /** git object id (blob, or commit for submodules). */
  objectId?: string;
}

export interface ReadResult {
  entry: SourceEntry;
  sha256: string;
  /** Present only when the caller asked to keep this file's content. */
  content: Buffer | null;
}

export interface RepoSource {
  readonly kind: 'git' | 'directory';
  readonly name: string;
  readonly root: string;
  readonly git: GitRepo | null;
  readonly commit: string | null;
  list(): Promise<SourceEntry[]>;
  /** Hash every entry and hand back content for those `keep` selects. Order follows `entries`. */
  readAll(entries: SourceEntry[], keep: (e: SourceEntry) => boolean, onRead: (r: ReadResult) => void): Promise<void>;
  /** Read one file's content at the snapshot (used for small metadata files like .gitmodules). */
  readText(path: string): Promise<string | null>;
}

export class GitSource implements RepoSource {
  readonly kind = 'git' as const;
  private entriesCache: SourceEntry[] | null = null;

  constructor(
    readonly name: string,
    readonly root: string,
    readonly git: GitRepo,
    readonly commit: string,
  ) {}

  static async open(root: string, opts: { name?: string; ref?: string } = {}): Promise<GitSource> {
    const git = await GitRepo.open(root);
    const commit = await git.resolve(opts.ref ?? 'HEAD');
    // Prefer the remote's owner/repo so two checkouts of the same commit yield the same dossier.
    const name = opts.name ?? nameFromRemote(await git.remoteUrl()) ?? root.replace(/\/+$/, '').split('/').pop()!.replace(/\.git$/, '');
    return new GitSource(name, root, git, commit);
  }

  async list(): Promise<SourceEntry[]> {
    if (this.entriesCache) return this.entriesCache;
    const tree = await this.git.lsTree(this.commit);
    const entries: SourceEntry[] = [];
    for (const t of tree) {
      const path = normalizePath(t.path);
      if (t.type === 'commit' || t.mode === '160000') {
        entries.push({ path, mode: 'submodule', size: 0, objectId: t.id });
      } else if (t.type === 'blob') {
        const mode: EntryMode = t.mode === '120000' ? 'symlink' : t.mode === '100755' ? 'exec' : 'file';
        entries.push({ path, mode, size: t.size ?? 0, objectId: t.id });
      }
    }
    this.entriesCache = entries;
    return entries;
  }

  async readAll(entries: SourceEntry[], keep: (e: SourceEntry) => boolean, onRead: (r: ReadResult) => void): Promise<void> {
    const byObject = new Map<string, SourceEntry[]>();
    const order: string[] = [];
    for (const e of entries) {
      if (e.mode === 'submodule' || !e.objectId) {
        onRead({ entry: e, sha256: createHash('sha256').update(`submodule:${e.objectId ?? ''}`).digest('hex'), content: null });
        continue;
      }
      if (!byObject.has(e.objectId)) {
        byObject.set(e.objectId, []);
        order.push(e.objectId);
      }
      byObject.get(e.objectId)!.push(e);
    }
    await catFileBatch(
      this.root,
      order,
      (obj, content, digest) => {
        for (const e of byObject.get(obj.id) ?? []) {
          onRead({ entry: e, sha256: digest ?? '', content: keep(e) ? content : null });
        }
      },
      { keep: (id) => (byObject.get(id) ?? []).some(keep), hash: true },
    );
  }

  async readText(path: string): Promise<string | null> {
    const entry = (await this.list()).find((e) => e.path === path && e.mode !== 'submodule');
    if (!entry?.objectId) return null;
    let text: string | null = null;
    await catFileBatch(
      this.root,
      [entry.objectId],
      (_o, content) => {
        text = content ? content.toString('utf8') : null;
      },
      { keep: (_id, size) => size <= 4 * 1024 * 1024, hash: false },
    );
    return text;
  }
}

export function nameFromRemote(remote: string | null): string | null {
  if (!remote) return null;
  const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** A plain directory (e.g. an extracted ZIP). Symlinks are recorded, never followed. */
export class DirectorySource implements RepoSource {
  readonly kind = 'directory' as const;
  readonly git = null;
  readonly commit = null;
  private entriesCache: SourceEntry[] | null = null;

  constructor(
    readonly name: string,
    readonly root: string,
    private readonly maxEntries = 500_000,
  ) {}

  async list(): Promise<SourceEntry[]> {
    if (this.entriesCache) return this.entriesCache;
    const out: SourceEntry[] = [];
    const walk = async (rel: string): Promise<void> => {
      const abs = rel ? join(this.root, rel) : this.root;
      const names = (await readdir(abs)).sort();
      for (const name of names) {
        if (out.length >= this.maxEntries) return;
        if (!rel && name === '.git') continue;
        const childRel = rel ? `${rel}/${name}` : name;
        const st = await lstat(join(this.root, childRel));
        if (st.isSymbolicLink()) out.push({ path: childRel, mode: 'symlink', size: st.size });
        else if (st.isDirectory()) await walk(childRel);
        else if (st.isFile()) out.push({ path: childRel, mode: st.mode & 0o111 ? 'exec' : 'file', size: st.size });
      }
    };
    await walk('');
    this.entriesCache = out;
    return out;
  }

  async readAll(entries: SourceEntry[], keep: (e: SourceEntry) => boolean, onRead: (r: ReadResult) => void): Promise<void> {
    for (const e of entries) {
      const abs = join(this.root, e.path);
      if (e.mode === 'symlink') {
        const target = await readlink(abs);
        onRead({ entry: e, sha256: createHash('sha256').update(target).digest('hex'), content: keep(e) ? Buffer.from(target) : null });
        continue;
      }
      if (keep(e)) {
        const content = await readFile(abs);
        onRead({ entry: e, sha256: createHash('sha256').update(content).digest('hex'), content });
      } else {
        const hash = createHash('sha256');
        await new Promise<void>((resolve, reject) => {
          createReadStream(abs)
            .on('data', (c) => hash.update(c))
            .on('end', () => resolve())
            .on('error', reject);
        });
        onRead({ entry: e, sha256: hash.digest('hex'), content: null });
      }
    }
  }

  async readText(path: string): Promise<string | null> {
    const entry = (await this.list()).find((e) => e.path === path && e.mode !== 'symlink');
    if (!entry || entry.size > 4 * 1024 * 1024) return null;
    return (await readFile(join(this.root, path))).toString('utf8');
  }
}
