import { catFileBatch, gitText, runGit } from './run.js';
import { parseRawCommit, type RawCommit } from './commit.js';

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'commit' | 'tree';
  id: string;
  size: number | null;
  path: string;
}

export interface FileChange {
  path: string;
  added: number | null;
  deleted: number | null;
}

export interface BlameLine {
  commit: string;
  origLine: number;
  finalLine: number;
  origPath: string;
}

const HEX = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Read-only access to a git repository (bare or with a work tree). */
export class GitRepo {
  private constructor(
    readonly dir: string,
    readonly bare: boolean,
  ) {}

  static async open(dir: string): Promise<GitRepo> {
    const bare = (await gitText(['rev-parse', '--is-bare-repository'], { cwd: dir })).trim() === 'true';
    return new GitRepo(dir, bare);
  }

  static async isRepository(dir: string): Promise<boolean> {
    try {
      const out = await runGit(['rev-parse', '--git-dir'], { cwd: dir, allowFailure: true });
      return out.code === 0;
    } catch {
      return false;
    }
  }

  async resolve(ref: string): Promise<string> {
    if (ref.startsWith('-')) throw new Error(`refusing ref that looks like an option: ${ref}`);
    return (await gitText(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: this.dir })).trim();
  }

  async treeId(commit: string): Promise<string> {
    return (await gitText(['rev-parse', '--verify', `${commit}^{tree}`], { cwd: this.dir })).trim();
  }

  async isShallow(): Promise<boolean> {
    return (await gitText(['rev-parse', '--is-shallow-repository'], { cwd: this.dir })).trim() === 'true';
  }

  async currentBranch(): Promise<string | null> {
    const out = await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: this.dir, allowFailure: true });
    const name = out.stdout.toString('utf8').trim();
    return out.code === 0 && name ? name : null;
  }

  /** Remote URL with any embedded credentials removed. */
  async remoteUrl(): Promise<string | null> {
    const out = await runGit(['config', '--get', 'remote.origin.url'], { cwd: this.dir, allowFailure: true });
    const url = out.stdout.toString('utf8').trim();
    if (out.code !== 0 || !url) return null;
    return redactUrl(url);
  }

  async isDirty(): Promise<boolean> {
    if (this.bare) return false;
    const out = await runGit(['status', '--porcelain', '--untracked-files=no'], { cwd: this.dir, allowFailure: true });
    return out.code === 0 && out.stdout.length > 0;
  }

  async lsTree(commit: string): Promise<TreeEntry[]> {
    const { stdout } = await runGit(['ls-tree', '-r', '-z', '-l', '--full-tree', commit], { cwd: this.dir });
    const entries: TreeEntry[] = [];
    for (const rec of stdout.toString('utf8').split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const meta = rec.slice(0, tab).split(/\s+/);
      const path = rec.slice(tab + 1);
      const [mode, type, id, size] = meta;
      if (!mode || !type || !id) continue;
      entries.push({
        mode,
        type: type as TreeEntry['type'],
        id,
        size: size && size !== '-' ? Number(size) : null,
        path,
      });
    }
    return entries;
  }

  /** Commit ids reachable from `commit`, newest first, at most `max`. */
  async revList(commit: string, max: number): Promise<{ ids: string[]; total: number }> {
    const { stdout } = await runGit(['rev-list', `--max-count=${max + 1}`, commit], { cwd: this.dir });
    const ids = stdout.toString('utf8').split('\n').filter((l) => HEX.test(l));
    let total = ids.length;
    if (ids.length > max) {
      total = Number((await gitText(['rev-list', '--count', commit], { cwd: this.dir })).trim());
      ids.length = max;
    }
    return { ids, total };
  }

  async rootCommits(commit: string): Promise<string[]> {
    const out = await gitText(['rev-list', '--max-parents=0', commit], { cwd: this.dir });
    return out.split('\n').filter((l) => HEX.test(l));
  }

  async readCommits(ids: string[]): Promise<RawCommit[]> {
    const commits: RawCommit[] = [];
    await catFileBatch(
      this.dir,
      ids,
      (obj, content) => {
        if (obj.missing || obj.type !== 'commit' || !content) return;
        commits.push(parseRawCommit(obj.id, content));
      },
      { keep: () => true, hash: false },
    );
    return commits;
  }

  /** Per-commit file changes (non-merge commits). Binary files report null counts. */
  async fileChanges(ids: string[]): Promise<Map<string, FileChange[]>> {
    const result = new Map<string, FileChange[]>();
    if (ids.length === 0) return result;
    const { stdout } = await runGit(['diff-tree', '--root', '-r', '-z', '--numstat', '--no-renames', '--stdin'], {
      cwd: this.dir,
      input: ids.join('\n') + '\n',
    });
    let current: FileChange[] | null = null;
    for (const tok of stdout.toString('utf8').split('\0')) {
      if (!tok) continue;
      const t1 = tok.indexOf('\t');
      if (t1 < 0) {
        const id = tok.trim();
        if (HEX.test(id)) {
          current = [];
          result.set(id, current);
        }
        continue;
      }
      const t2 = tok.indexOf('\t', t1 + 1);
      if (t2 < 0 || !current) continue;
      const a = tok.slice(0, t1);
      const d = tok.slice(t1 + 1, t2);
      current.push({
        path: tok.slice(t2 + 1),
        added: a === '-' ? null : Number(a),
        deleted: d === '-' ? null : Number(d),
      });
    }
    return result;
  }

  async refs(): Promise<{ branches: string[]; tags: string[]; notes: string[] }> {
    const out = await gitText(['for-each-ref', '--format=%(refname)'], { cwd: this.dir });
    const branches: string[] = [];
    const tags: string[] = [];
    const notes: string[] = [];
    for (const ref of out.split('\n')) {
      // Local and remote-tracking branches are the same branch seen from different clones.
      if (ref.startsWith('refs/heads/')) branches.push(ref.slice('refs/heads/'.length));
      else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) branches.push(ref.slice('refs/remotes/'.length).split('/').slice(1).join('/'));
      else if (ref.startsWith('refs/tags/')) tags.push(ref.slice('refs/tags/'.length));
      else if (ref.startsWith('refs/notes/')) notes.push(ref);
    }
    return { branches: [...new Set(branches)].sort(), tags: tags.sort(), notes: notes.sort() };
  }

  /** Notes attached to commits under `ref`, as commit id -> note text. */
  async notes(ref: string): Promise<Map<string, string>> {
    const out = await runGit(['notes', `--ref=${ref}`, 'list'], { cwd: this.dir, allowFailure: true });
    const pairs: Array<[string, string]> = [];
    if (out.code === 0) {
      for (const line of out.stdout.toString('utf8').split('\n')) {
        const [noteId, commit] = line.trim().split(/\s+/);
        if (noteId && commit && HEX.test(noteId) && HEX.test(commit)) pairs.push([noteId, commit]);
      }
    }
    const result = new Map<string, string>();
    const byNote = new Map<string, string[]>();
    for (const [n, c] of pairs) byNote.set(n, [...(byNote.get(n) ?? []), c]);
    const noteIds = [...byNote.keys()];
    await catFileBatch(
      this.dir,
      noteIds,
      (obj, content) => {
        if (!content || obj.missing) return;
        const text = content.toString('utf8');
        for (const c of byNote.get(obj.id) ?? []) result.set(c, text);
      },
      { keep: (_id, size) => size <= 4 * 1024 * 1024, hash: false },
    );
    return result;
  }

  /** Commit dates of the notes ref history: when notes were written. */
  async notesWrittenAt(ref: string): Promise<string[]> {
    const out = await runGit(['log', '--format=%cI', ref], { cwd: this.dir, allowFailure: true });
    if (out.code !== 0) return [];
    return out.stdout.toString('utf8').split('\n').filter(Boolean);
  }

  /** Line counts of files at given revisions; missing files map to null. */
  async lineCountsAt(specs: Array<{ rev: string; path: string }>): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    const names: string[] = [];
    for (const s of specs) {
      const key = `${s.rev}:${s.path}`;
      if (out.has(key) || s.path.includes('\n') || !HEX.test(s.rev)) {
        if (!out.has(key)) out.set(key, null);
        continue;
      }
      out.set(key, null);
      names.push(key);
    }
    let i = 0;
    await catFileBatch(
      this.dir,
      names,
      (obj, content) => {
        const key = names[i++]!;
        if (obj.missing || obj.type !== 'blob' || !content) return;
        const text = content.toString('utf8');
        let n = 0;
        for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) n++;
        out.set(key, text.length && !text.endsWith('\n') ? n + 1 : n);
      },
      { keep: (_id, size) => size <= 16 * 1024 * 1024, hash: false },
    );
    return out;
  }

  async blame(commit: string, path: string): Promise<BlameLine[]> {
    const { stdout } = await runGit(['blame', '--porcelain', commit, '--', path], {
      cwd: this.dir,
      maxBytes: 256 * 1024 * 1024,
    });
    return parseBlamePorcelain(stdout.toString('utf8'));
  }

  /** Blob ids reachable from `commit` (all history), for history-wide scans. */
  async historyBlobs(commit: string, maxObjects: number): Promise<{ blobs: Array<{ id: string; path: string }>; truncated: boolean }> {
    const named = await runGit(['rev-list', '--objects', '--filter=object:type=blob', commit], { cwd: this.dir });
    const blobs: Array<{ id: string; path: string }> = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const line of named.stdout.toString('utf8').split('\n')) {
      const sp = line.indexOf(' ');
      if (sp < 0) continue; // commits carry no name
      const id = line.slice(0, sp);
      if (seen.has(id)) continue;
      seen.add(id);
      blobs.push({ id, path: line.slice(sp + 1) });
      if (blobs.length >= maxObjects) {
        truncated = true;
        break;
      }
    }
    return { blobs, truncated };
  }
}

export function parseBlamePorcelain(text: string): BlameLine[] {
  const lines = text.split('\n');
  const out: BlameLine[] = [];
  const pathByCommit = new Map<string, string>();
  let pending: { commit: string; orig: number; final: number } | null = null;
  for (const line of lines) {
    if (line.startsWith('\t')) {
      if (pending) {
        out.push({
          commit: pending.commit,
          origLine: pending.orig,
          finalLine: pending.final,
          origPath: pathByCommit.get(pending.commit) ?? '',
        });
      }
      pending = null;
      continue;
    }
    const header = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (header) {
      pending = { commit: header[1]!, orig: Number(header[2]), final: Number(header[3]) };
      continue;
    }
    if (pending && line.startsWith('filename ')) pathByCommit.set(pending.commit, line.slice('filename '.length));
  }
  return out;
}

/** Strip credentials and query strings from a remote URL. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.search = '';
    return u.toString();
  } catch {
    // scp-like syntax git@host:org/repo.git has no password component.
    return url.replace(/\/\/[^@/]+@/, '//');
  }
}
