import type { GitRepo, FileChange } from '../git/repo.js';
import type { RawCommit } from '../git/commit.js';
import { pullRequestFromMessage } from '../git/commit.js';

export interface HistoryCommit extends RawCommit {
  changes: FileChange[];
  pullRequest: number | null;
  /** True when this commit arrived through a merge commit (it is not on the first-parent line). */
  mergedViaMerge: boolean;
}

export interface History {
  head: string;
  commits: HistoryCommit[];
  byId: Map<string, HistoryCommit>;
  shallow: boolean;
  truncated: boolean;
  total: number;
  roots: string[];
  branches: string[];
  tags: string[];
  notesRefs: string[];
  /** Commits touching each path (newest first). */
  commitsByPath: Map<string, HistoryCommit[]>;
}

export async function loadHistory(git: GitRepo, head: string, maxCommits: number): Promise<History> {
  const [{ ids, total }, shallow, roots, refs] = await Promise.all([
    git.revList(head, maxCommits),
    git.isShallow(),
    git.rootCommits(head),
    git.refs(),
  ]);
  const raw = await git.readCommits(ids);
  const changes = await git.fileChanges(ids);
  const byId = new Map<string, HistoryCommit>();
  const order = new Map(ids.map((id, i) => [id, i]));
  raw.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  // Walk the first-parent chain from head; everything else arrived via a merge.
  const firstParent = new Set<string>();
  const rawById = new Map(raw.map((c) => [c.id, c]));
  let cursor: string | undefined = head;
  while (cursor && rawById.has(cursor) && !firstParent.has(cursor)) {
    firstParent.add(cursor);
    cursor = rawById.get(cursor)!.parents[0];
  }

  const commits: HistoryCommit[] = raw.map((c) => {
    const hc: HistoryCommit = {
      ...c,
      changes: changes.get(c.id) ?? [],
      pullRequest: pullRequestFromMessage(c.subject, c.body),
      mergedViaMerge: !firstParent.has(c.id),
    };
    byId.set(c.id, hc);
    return hc;
  });

  // Squash merges and merge commits reference PRs; propagate a merge commit's PR to the
  // commits it brought in (second-parent side) so each change knows how it landed.
  for (const c of commits) {
    if (c.parents.length < 2 || c.pullRequest === null) continue;
    const stack = [c.parents[1]!];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || firstParent.has(id)) continue;
      seen.add(id);
      const inner = byId.get(id);
      if (!inner) continue;
      if (inner.pullRequest === null) inner.pullRequest = c.pullRequest;
      stack.push(...inner.parents);
    }
  }

  const commitsByPath = new Map<string, HistoryCommit[]>();
  for (const c of commits) {
    for (const ch of c.changes) {
      const list = commitsByPath.get(ch.path);
      if (list) list.push(c);
      else commitsByPath.set(ch.path, [c]);
    }
  }

  return {
    head,
    commits,
    byId,
    shallow,
    truncated: ids.length < total,
    total,
    roots,
    branches: refs.branches,
    tags: refs.tags,
    notesRefs: refs.notes,
    commitsByPath,
  };
}

/** Lines added in the first commit that brought the repository its content. */
export function rootImportSize(history: History): { commit: HistoryCommit; files: number; lines: number } | null {
  const oldest = history.commits[history.commits.length - 1];
  if (!oldest || history.truncated || history.shallow) return null;
  const lines = oldest.changes.reduce((s, ch) => s + (ch.added ?? 0), 0);
  return { commit: oldest, files: oldest.changes.length, lines };
}
