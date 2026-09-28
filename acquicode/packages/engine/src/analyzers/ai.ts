import type { RepoContext } from '../context.js';
import type {
  AiEvidenceSummary,
  AiFileCategory,
  AiToolUse,
  FileAiStatus,
  FileEntry,
  ProvenanceState,
} from '../model.js';
import { combineAny } from '../states.js';
import { commitSignals, fileHeaderAiMarker, vendorOf, type CommitSignal } from '../provenance/signals.js';
import { parseAgentTrace, parseGitAiNote, type LineRecord, type ParseProblem } from '../provenance/formats.js';
import { agentConfigTool, isAgentTraceFile } from './classify.js';
import { matchesAny } from '../util/paths.js';
import type { HistoryCommit } from './history.js';
import type { PullRequestReview } from '../enrich/types.js';
import { sortBy } from '../canonical.js';

const DETECTOR = {
  signal: 'ai.commit_signal@1',
  gitai: 'ai.git_ai_note@1',
  trace: 'ai.agent_trace@1',
  config: 'ai.agent_config@1',
  header: 'ai.file_header@1',
  bulk: 'ai.bulk_unattributed@1',
  decl: 'declaration.origin@1',
};

/** Inference threshold for "large unattributed change": lines added and files touched. */
const BULK_LINES = 800;
const BULK_FILES = 8;
/** A trace committed this long after the revision it describes is treated as retroactive. */
const RETROACTIVE_DAYS = 30;

export interface SuppliedTrace {
  name: string;
  text: string;
}

export interface AiResult {
  summary: AiEvidenceSummary;
  /** Per-commit AI signal labels, for the commit table. */
  commitSignals: Map<string, string[]>;
  reviews: Map<number, PullRequestReview>;
}

/** First-party code: source and test files that are not vendored, generated or binary. */
function firstParty(f: FileEntry): boolean {
  if (f.contentSkipped === 'submodule' || f.contentSkipped === 'symlink' || f.contentSkipped === 'binary') return false;
  if (!f.classes.includes('source') && !f.classes.includes('test')) return false;
  return !f.classes.some((c) => c === 'vendored' || c === 'generated' || c === 'lockfile' || c === 'binary' || c === 'asset');
}

export async function analyzeAi(ctx: RepoContext, suppliedTraces: SuppliedTrace[], forgeReviews: (prs: number[]) => Promise<Map<number, PullRequestReview> | null>): Promise<AiResult> {
  const { history, evidence, findings, unknowns, declarations } = ctx;
  const considered = ctx.files.filter(firstParty);
  const tools = new Map<string, AiToolUse & { commitIds: Set<string> }>();
  const touchTool = (tool: string, signal: string, state: ProvenanceState, at: string | null, model: string | null, commit?: string) => {
    let t = tools.get(tool);
    if (!t) {
      t = { tool, vendor: vendorOf(tool), models: [], commits: 0, firstSeen: null, lastSeen: null, signals: [], state, commitIds: new Set() };
      tools.set(tool, t);
    }
    if (!t.signals.includes(signal)) t.signals.push(signal);
    if (model && !t.models.includes(model)) t.models.push(model);
    if (commit) t.commitIds.add(commit);
    if (at) {
      if (!t.firstSeen || at < t.firstSeen) t.firstSeen = at;
      if (!t.lastSeen || at > t.lastSeen) t.lastSeen = at;
    }
    t.state = combineAny([t.state, state]);
  };

  // ---------------------------------------------------------------- repo-level corroboration
  const agentConfigFiles: string[] = [];
  let firstAgentConfigAt: string | null = null;
  for (const f of ctx.files) {
    const tool = agentConfigTool(f.path);
    if (!tool) continue;
    agentConfigFiles.push(f.path);
    const added = history?.commitsByPath.get(f.path)?.at(-1);
    const at = added?.author.date ?? null;
    if (at && (!firstAgentConfigAt || at < firstAgentConfigAt)) firstAgentConfigAt = at;
    const id = evidence.add({
      kind: 'repo.agent_config',
      detector: DETECTOR.config,
      state: 'OBSERVED',
      evidenceClass: 'CORROBORATING',
      locator: { path: f.path, ...(added ? { commit: added.id } : {}) },
      extract: tool,
      attributes: { tool, firstAddedAt: at },
    });
    void id;
    touchTool(tool, 'config-file', 'OBSERVED', at, null);
  }

  // ---------------------------------------------------------------- commit-level signals
  // Direct signals attribute a commit to a tool. Editor-inserted trailers only corroborate
  // that a tool was present in the editor (see EDITOR_TRAILER_CAVEAT).
  const signalsByCommit = new Map<string, CommitSignal[]>();
  const editorByCommit = new Map<string, CommitSignal[]>();
  const signalEvidence = new Map<string, string[]>();
  const editorEvidence: string[] = [];
  const commitLabels = new Map<string, string[]>();
  for (const c of history?.commits ?? []) {
    const sigs = commitSignals(c);
    if (!sigs.length) continue;
    const direct = sigs.filter((s) => s.reliability === 'direct');
    const editor = sigs.filter((s) => s.reliability === 'editor_inserted');
    if (direct.length) signalsByCommit.set(c.id, direct);
    if (editor.length) editorByCommit.set(c.id, editor);
    const ids: string[] = [];
    for (const s of sigs) {
      const isDirect = s.reliability === 'direct';
      const id = evidence.add({
        kind: 'commit.ai_signal',
        detector: DETECTOR.signal,
        state: 'OBSERVED',
        evidenceClass: isDirect ? 'DIRECT' : 'CORROBORATING',
        locator: { commit: c.id },
        extract: s.value,
        attributes: { tool: s.tool, signal: s.kind, model: s.model, selfDeclared: true, signedCommit: c.signed, reliability: s.reliability, ...(s.caveat ? { caveat: s.caveat } : {}) },
      });
      ids.push(id);
      if (isDirect) touchTool(s.tool, s.kind === 'bot_author' || s.kind === 'bot_committer' ? 'agent-authored-commit' : 'commit-metadata', 'OBSERVED', c.author.date, s.model, c.id);
      else {
        editorEvidence.push(id);
        // The trailer is observed; that the tool took part in this change is only inferred.
        touchTool(s.tool, 'editor-inserted-trailer', 'INFERRED', c.author.date, null);
      }
    }
    signalEvidence.set(c.id, ids);
    commitLabels.set(c.id, [...new Set(sigs.map((s) => `${s.tool}:${s.reliability === 'direct' ? s.kind : 'editor_trailer'}`))].sort());
  }

  // ---------------------------------------------------------------- line-level records
  const problems: ParseProblem[] = [];
  const records: Array<LineRecord & { state: ProvenanceState; evidenceId: string }> = [];
  if (history && ctx.source.git) {
    for (const ref of history.notesRefs.filter((r) => r === 'refs/notes/ai' || r.startsWith('refs/notes/ai-'))) {
      const notes = await ctx.source.git.notes(ref);
      for (const [commit, text] of [...notes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (!history.byId.has(commit)) continue; // notes for commits outside the analysed history
        const parsed = parseGitAiNote(commit, text, null);
        problems.push(...parsed.problems);
        for (const r of parsed.records) records.push({ ...r, origin: r.origin.replace('refs/notes/ai', ref), state: 'OBSERVED', evidenceId: '' });
      }
    }
  }
  // Agent Trace files committed to the repository.
  for (const f of ctx.files) {
    if (!isAgentTraceFile(f.path)) continue;
    const text = ctx.text.get(f.path);
    if (text === undefined) continue;
    const parsed = parseAgentTrace(text, f.path);
    problems.push(...parsed.problems);
    const addedAt = history?.commitsByPath.get(f.path)?.at(-1)?.committer.date ?? null;
    for (const r of parsed.records) {
      const rev = history?.byId.get(r.revision) ?? [...(history?.byId.values() ?? [])].find((c) => r.revision.length >= 7 && c.id.startsWith(r.revision));
      let state: ProvenanceState = 'OBSERVED';
      if (rev && addedAt && daysBetween(rev.committer.date, addedAt) > RETROACTIVE_DAYS) state = 'USER_ASSERTED';
      records.push({ ...r, revision: rev?.id ?? r.revision, state, evidenceId: '' });
    }
  }
  // Traces supplied out of band: we cannot know when they were produced.
  for (const t of suppliedTraces) {
    const parsed = parseAgentTrace(t.text, `supplied:${t.name}`);
    problems.push(...parsed.problems);
    for (const r of parsed.records) {
      const rev = history?.byId.get(r.revision) ?? [...(history?.byId.values() ?? [])].find((c) => r.revision.length >= 7 && c.id.startsWith(r.revision));
      records.push({ ...r, revision: rev?.id ?? r.revision, state: 'USER_ASSERTED', evidenceId: '' });
    }
  }

  // Check every record against the repository: revision exists, file exists, ranges fit.
  let unverifiable = 0;
  if (records.length && ctx.source.git) {
    const specs = records.filter((r) => history?.byId.has(r.revision)).slice(0, 20_000).map((r) => ({ rev: r.revision, path: r.path }));
    const counts = await ctx.source.git.lineCountsAt(specs);
    for (const r of records) {
      let reason: string | null = null;
      if (!history?.byId.has(r.revision)) reason = 'revision not found in the analysed history';
      else {
        const n = counts.get(`${r.revision}:${r.path}`);
        if (n === undefined) reason = null; // beyond the check budget; left as recorded
        else if (n === null) reason = 'file does not exist at the recorded revision';
        else if (r.ranges.some((rg) => rg.end > n)) reason = `ranges exceed the file's ${n} lines at that revision`;
      }
      if (reason) {
        r.state = 'UNVERIFIABLE';
        unverifiable++;
        problems.push({ origin: r.origin, problem: `${r.path}: ${reason}` });
      }
    }
  } else if (records.length) {
    for (const r of records) r.state = 'UNVERIFIABLE';
    unverifiable = records.length;
  }

  for (const r of records) {
    const ai = r.ranges.filter((x) => x.type === 'ai').reduce((s, x) => s + x.end - x.start + 1, 0);
    const human = r.ranges.filter((x) => x.type === 'human').reduce((s, x) => s + x.end - x.start + 1, 0);
    const toolsInRec = [...new Set(r.ranges.map((x) => x.tool).filter((x): x is string => !!x))].sort();
    r.evidenceId = evidence.add({
      kind: r.format === 'git-ai' ? 'provenance.git_ai_note' : 'provenance.agent_trace',
      detector: r.format === 'git-ai' ? DETECTOR.gitai : DETECTOR.trace,
      state: r.state,
      evidenceClass: 'DIRECT',
      locator: { commit: r.revision, path: r.path, source: r.origin },
      extract: `${r.format} ${r.schemaVersion}`,
      attributes: { aiLines: ai, humanLines: human, tools: toolsInRec.join(',') || null, recordedAt: r.recordedAt },
    });
    if (r.state !== 'UNVERIFIABLE') {
      const at = history?.byId.get(r.revision)?.author.date ?? null;
      for (const rg of r.ranges) if (rg.type === 'ai') touchTool(rg.tool ?? 'unspecified-ai', r.format, r.state, at, rg.model, r.revision);
    }
  }
  for (const p of problems.slice(0, 200)) {
    evidence.add({ kind: 'provenance.parse_problem', detector: DETECTOR.trace, state: 'UNVERIFIABLE', locator: { source: p.origin }, extract: p.problem, attributes: {} });
  }

  // Index usable records by (revision, path) and detect disagreements between sources.
  const recIndex = new Map<string, Array<LineRecord & { state: ProvenanceState; evidenceId: string }>>();
  for (const r of records) {
    if (r.state === 'UNVERIFIABLE') continue;
    const key = `${r.revision}\0${r.path}`;
    recIndex.set(key, [...(recIndex.get(key) ?? []), r]);
  }
  let contradictions = 0;
  for (const [key, recs] of recIndex) {
    if (recs.length < 2) continue;
    const conflictLines = new Set<number>();
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        for (const a of recs[i]!.ranges) {
          for (const b of recs[j]!.ranges) {
            if ((a.type === 'ai' && b.type === 'human') || (a.type === 'human' && b.type === 'ai')) {
              const lo = Math.max(a.start, b.start);
              const hi = Math.min(a.end, b.end);
              for (let l = lo; l <= hi && conflictLines.size < 100_000; l++) conflictLines.add(l);
            }
          }
        }
      }
    }
    if (conflictLines.size) {
      contradictions++;
      const [rev, path] = key.split('\0') as [string, string];
      findings.add({
        rule: 'AI-003',
        state: 'CONFLICTING',
        summary: `Attribution records for ${path} at ${rev.slice(0, 12)} disagree on ${conflictLines.size} line(s): one source says AI, another says human.`,
        evidence: recs.map((r) => r.evidenceId),
        fingerprint: key,
      });
      for (const r of recs) r.state = 'CONFLICTING';
    }
  }

  // ---------------------------------------------------------------- file header markers
  const headerByPath = new Map<string, string>();
  for (const f of considered) {
    const text = ctx.text.get(f.path);
    if (!text) continue;
    const m = fileHeaderAiMarker(text);
    if (!m) continue;
    const id = evidence.add({
      kind: 'file.ai_marker',
      detector: DETECTOR.header,
      state: 'OBSERVED',
      evidenceClass: 'CORROBORATING',
      locator: { path: f.path },
      extract: m.marker,
      attributes: { tool: m.tool, selfDeclared: true },
    });
    headerByPath.set(f.path, id);
    touchTool(m.tool, 'file-comment', 'OBSERVED', null, null);
  }

  // ---------------------------------------------------------------- inference: bulk unattributed changes
  const inferredByPath = new Map<string, string>();
  if (history && firstAgentConfigAt) {
    for (const c of history.commits) {
      if (signalsByCommit.has(c.id) || c.parents.length > 1) continue;
      if (c.author.date < firstAgentConfigAt) continue;
      if ([...recIndex.keys()].some((k) => k.startsWith(`${c.id}\0`))) continue;
      const relevant = c.changes.filter((ch) => {
        const fe = ctx.fileIndex.get(ch.path);
        return fe ? firstParty(fe) : !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$/.test(ch.path);
      });
      const added = relevant.reduce((s, ch) => s + (ch.added ?? 0), 0);
      if (added < BULK_LINES || relevant.length < BULK_FILES) continue;
      const id = evidence.add({
        kind: 'commit.bulk_unattributed',
        detector: DETECTOR.bulk,
        state: 'INFERRED',
        evidenceClass: 'INFERENCE',
        locator: { commit: c.id },
        extract: c.subject,
        attributes: { linesAdded: added, files: relevant.length, after: firstAgentConfigAt },
      });
      for (const ch of relevant) if (!inferredByPath.has(ch.path)) inferredByPath.set(ch.path, id);
      findings.add({
        rule: 'AI-006',
        state: 'INFERRED',
        summary: `Commit ${c.id.slice(0, 12)} ("${truncate(c.subject, 60)}") added ${added} lines across ${relevant.length} files with no AI attribution, after AI tool configuration first appeared (${firstAgentConfigAt.slice(0, 10)}). This is an inference, not evidence of AI origin; ask how it was produced.`,
        evidence: [id],
        fingerprint: c.id,
      });
    }
  }

  // ---------------------------------------------------------------- blame-based line attribution at HEAD
  const aiCommitIds = new Set<string>([...signalsByCommit.keys()]);
  for (const r of records) if (r.state !== 'UNVERIFIABLE' && r.ranges.some((x) => x.type === 'ai')) aiCommitIds.add(r.revision);
  const haveLineRecords = recIndex.size > 0;
  const hasDirectSignals = aiCommitIds.size > 0;
  const needBlame = aiCommitIds.size > 0 || haveLineRecords;
  const lineStats = new Map<string, { ai: number; human: number; fromAiCommits: number; total: number; evidence: Set<string>; tools: Set<string>; conflicting: boolean; states: ProvenanceState[] }>();
  let blamed = 0;
  let blameComplete = true;
  if (needBlame && history && ctx.source.git && ctx.source.commit) {
    const touchedByAi = (path: string) => (history.commitsByPath.get(path) ?? []).some((c) => aiCommitIds.has(c.id));
    const recordPaths = new Set([...recIndex.keys()].map((k) => k.split('\0')[1]!));
    const candidates = sortBy(
      considered.filter((f) => f.lines !== undefined && f.lines > 0),
      (f) => (recordPaths.has(f.path) || touchedByAi(f.path) ? 0 : 1),
      (f) => f.path,
    );
    const budget = ctx.limits.maxBlameFiles;
    if (candidates.length > budget) blameComplete = false;
    const toBlame = candidates.slice(0, budget);
    const git = ctx.source.git;
    const head = ctx.source.commit;
    await runPool(toBlame, 4, async (f) => {
      let lines;
      try {
        lines = await git.blame(head, f.path);
      } catch {
        blameComplete = false;
        return;
      }
      blamed++;
      const st = { ai: 0, human: 0, fromAiCommits: 0, total: lines.length, evidence: new Set<string>(), tools: new Set<string>(), conflicting: false, states: [] as ProvenanceState[] };
      for (const bl of lines) {
        if (signalsByCommit.has(bl.commit)) {
          st.fromAiCommits++;
          for (const id of signalEvidence.get(bl.commit) ?? []) st.evidence.add(id);
          for (const s of signalsByCommit.get(bl.commit) ?? []) st.tools.add(s.tool);
        }
        const recs = recIndex.get(`${bl.commit}\0${bl.origPath}`);
        if (!recs) continue;
        let isAi = false;
        let isHuman = false;
        for (const r of recs) {
          for (const rg of r.ranges) {
            if (bl.origLine < rg.start || bl.origLine > rg.end) continue;
            if (rg.type === 'ai') {
              isAi = true;
              if (rg.tool) st.tools.add(rg.tool);
              if (!st.states.includes(r.state)) st.states.push(r.state);
            } else if (rg.type === 'human') isHuman = true;
            st.evidence.add(r.evidenceId);
            if (r.state === 'CONFLICTING') st.conflicting = true;
          }
        }
        if (isAi && !isHuman) st.ai++;
        else if (isHuman && !isAi) st.human++;
      }
      lineStats.set(f.path, st);
    });
  }

  // ---------------------------------------------------------------- per-file status
  const counts: Record<AiFileCategory, number> & { humanRecorded: number } = {
    direct_line: 0,
    direct_commit: 0,
    corroborating: 0,
    inference: 0,
    none: 0,
    humanRecorded: 0,
  };
  let totalLines = 0;
  let aiLines = 0;
  let humanLines = 0;
  let linesFromAiCommits = 0;
  for (const f of considered) {
    const st = lineStats.get(f.path);
    const pathCommits = history?.commitsByPath.get(f.path) ?? [];
    const aiCommitsForPath = pathCommits.filter((c) => signalsByCommit.has(c.id));
    let status: FileAiStatus;
    const ev = new Set<string>(st?.evidence ?? []);
    if (st) {
      totalLines += st.total;
      aiLines += st.ai;
      humanLines += st.human;
      linesFromAiCommits += st.fromAiCommits;
    }
    if (st && st.ai > 0) {
      // A file is only as well-attributed as the records behind it (a retroactive trace is company-asserted).
      status = { category: 'direct_line', aiLines: st.ai, humanLines: st.human, linesFromAiCommits: st.fromAiCommits, tools: [...st.tools].sort(), evidence: [], state: st.conflicting ? 'CONFLICTING' : combineAny(st.states) };
    } else if (aiCommitsForPath.length > 0 || (st && st.fromAiCommits > 0)) {
      for (const c of aiCommitsForPath) for (const id of signalEvidence.get(c.id) ?? []) ev.add(id);
      const toolsHere = new Set<string>(st?.tools ?? []);
      for (const c of aiCommitsForPath) for (const s of signalsByCommit.get(c.id) ?? []) toolsHere.add(s.tool);
      status = { category: 'direct_commit', tools: [...toolsHere].sort(), evidence: [], state: 'OBSERVED' };
      if (st) {
        status.linesFromAiCommits = st.fromAiCommits;
        if (st.human) status.humanLines = st.human;
      }
    } else if (pathCommits.some((c) => editorByCommit.has(c.id))) {
      const editorCommits = pathCommits.filter((c) => editorByCommit.has(c.id));
      for (const c of editorCommits) for (const id of signalEvidence.get(c.id) ?? []) ev.add(id);
      const toolsHere = new Set<string>();
      for (const c of editorCommits) for (const sig of editorByCommit.get(c.id) ?? []) toolsHere.add(sig.tool);
      status = { category: 'corroborating', tools: [...toolsHere].sort(), evidence: [], state: 'OBSERVED' };
    } else if (headerByPath.has(f.path)) {
      ev.add(headerByPath.get(f.path)!);
      status = { category: 'corroborating', tools: [], evidence: [], state: 'OBSERVED' };
    } else if (inferredByPath.has(f.path)) {
      ev.add(inferredByPath.get(f.path)!);
      status = { category: 'inference', tools: [], evidence: [], state: 'INFERRED' };
    } else {
      status = { category: 'none', tools: [], evidence: [], state: 'UNKNOWN' };
      if (st && st.human > 0) status.humanLines = st.human;
    }
    if (headerByPath.has(f.path)) ev.add(headerByPath.get(f.path)!);
    if (st && st.total > 0 && st.human === st.total) counts.humanRecorded++;
    // Keep DIRECT items first so the cited sample always includes what justifies the category.
    const rank = (id: string) => (evidence.get(id)?.evidenceClass === 'DIRECT' ? 0 : 1);
    status.evidence = [...ev].sort((x, y) => rank(x) - rank(y) || (x < y ? -1 : x > y ? 1 : 0)).slice(0, 25);
    counts[status.category]++;
    f.ai = status;
  }

  // AI-011: files where the records attribute nearly everything to AI and nothing to a person.
  const predominantlyAi = considered.filter((f) => {
    const st = lineStats.get(f.path);
    return st && st.total >= 20 && st.human === 0 && st.ai / st.total >= 0.8;
  });
  if (predominantlyAi.length) {
    findings.add({
      rule: 'AI-011',
      state: 'DERIVED',
      summary: `${predominantlyAi.length} file(s) have line-level records attributing at least 80% of their current lines to AI tools and none to a named person (e.g. ${predominantlyAi.slice(0, 3).map((f) => f.path).join(', ')}). This is a statement about the records, not a legal conclusion on authorship.`,
      evidence: predominantlyAi.flatMap((f) => f.ai?.evidence ?? []).slice(0, 100),
      fingerprint: 'predominantly-ai',
    });
  }

  // ---------------------------------------------------------------- review evidence
  const directCommits = [...aiCommitIds].map((id) => history?.byId.get(id)).filter((c): c is HistoryCommit => !!c);
  const viaPr = directCommits.filter((c) => c.pullRequest !== null || c.mergedViaMerge);
  const pushed = directCommits.filter((c) => c.pullRequest === null && !c.mergedViaMerge);
  const prNumbers = [...new Set(viaPr.map((c) => c.pullRequest).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  let reviews = new Map<number, PullRequestReview>();
  let reviewSource: 'forge' | 'none' = 'none';
  const fetched = prNumbers.length ? await forgeReviews(prNumbers) : null;
  if (fetched) {
    reviews = fetched;
    reviewSource = 'forge';
  }
  let approvedByOther = 0;
  let notApproved = 0;
  let reviewUnknown = 0;
  for (const c of directCommits) {
    const pr = c.pullRequest !== null ? reviews.get(c.pullRequest) : undefined;
    if (!pr) {
      if (c.pullRequest === null) notApproved++;
      else reviewUnknown++;
      continue;
    }
    const others = pr.approvedBy.filter((a) => a && a !== pr.author);
    if (others.length) approvedByOther++;
    else notApproved++;
  }
  if (pushed.length) {
    findings.add({
      rule: 'AI-005',
      state: 'DERIVED',
      summary: `${pushed.length} of ${directCommits.length} commit(s) carrying AI attribution landed without a pull request or merge (pushed directly to the analysed branch), so there is no record of review.`,
      evidence: pushed.slice(0, 50).flatMap((c) => signalEvidence.get(c.id) ?? []),
      fingerprint: 'direct-push',
    });
  }
  if (reviewSource === 'forge' && notApproved - pushed.length > 0) {
    findings.add({
      rule: 'AI-005',
      state: 'OBSERVED',
      title: 'AI-attributed pull requests merged without approval from another person',
      summary: `${notApproved - pushed.length} AI-attributed commit(s) arrived through pull requests with no approving review from someone other than the author.`,
      evidence: [],
      fingerprint: 'unapproved-pr',
    });
  }
  if (directCommits.length && reviewSource === 'none') {
    unknowns.add(
      'ai_development',
      'Whether pull requests containing AI-attributed changes were approved by another person',
      'Review approvals live in the forge (GitHub/GitLab), not in git history.',
      'Connect the GitHub App or GitLab token, or supply review exports.',
    );
  }

  // ---------------------------------------------------------------- tools, declarations, gaps
  const toolList: AiToolUse[] = sortBy([...tools.values()], (t) => t.tool).map(({ commitIds, ...t }) => ({
    ...t,
    commits: commitIds.size,
    models: [...t.models].sort(),
    signals: [...t.signals].sort(),
  }));
  const directTools = toolList.filter((t) => t.commits > 0 || t.signals.includes('config-file'));
  for (const t of toolList) {
    const decl = declarations?.aiTools.find((d) => d.tool === t.tool);
    if (decl) {
      t.declared = {
        plan: decl.plan ?? null,
        indemnity: decl.indemnity ?? null,
        duplicateFilter: decl.duplicateFilter ?? null,
        from: decl.from ?? null,
        to: decl.to ?? null,
        evidence: decl.evidence ?? null,
      };
    }
  }
  const undeclared = directTools.filter((t) => !t.declared && t.tool !== 'agents-md' && t.tool !== 'mcp-client');
  if (undeclared.length) {
    findings.add({
      rule: 'AI-008',
      state: 'OBSERVED',
      summary: `Evidence shows use of ${undeclared.map((t) => t.tool).join(', ')} but the plan tier, IP indemnity and output-filter settings in force were not declared. Indemnities typically depend on paid commercial tiers and specific settings.`,
      evidence: [],
      fingerprint: undeclared.map((t) => t.tool).join(','),
    });
    unknowns.add(
      'ai_development',
      `Terms under which ${undeclared.map((t) => t.tool).join(', ')} ${undeclared.length > 1 ? 'were' : 'was'} used (plan tier, indemnity, filters)`,
      'The repository shows that a tool was used, not which account tier or settings applied.',
      'Declare ai_tools in acquicode.yml with plan, indemnity and the contract that supports it.',
    );
  }
  if (toolList.length) {
    findings.add({
      rule: 'AI-001',
      state: combineAny(toolList.map((t) => t.state)),
      summary: `Evidence of ${toolList.length} AI coding tool(s): ${toolList
        .map((t) => `${t.tool} (${t.commits ? `${t.commits} attributed commit${t.commits === 1 ? '' : 's'}` : t.signals.join(', ')})`)
        .join('; ')}.`,
      evidence: [...[...signalEvidence.values()].flat().slice(0, 60)],
      fingerprint: 'tools',
    });
  }

  const hasDirect = aiCommitIds.size > 0;
  if ((agentConfigFiles.length > 0 || declarations?.aiUsage === 'some' || (declarations?.aiTools.length ?? 0) > 0) && !hasDirect) {
    findings.add({
      rule: 'AI-009',
      state: 'OBSERVED',
      summary: `AI tool use is indicated (${agentConfigFiles.length ? `configuration files: ${agentConfigFiles.slice(0, 4).join(', ')}` : 'declared by the company'}) but no commit or line in the analysed history records AI attribution${editorByCommit.size ? ` (${editorByCommit.size} commit(s) carry only an editor-inserted trailer, which does not attribute the change)` : ''}. The origin of individual files cannot be established from the repository.`,
      evidence: [],
      fingerprint: 'unrecorded',
    });
  }
  if (!haveLineRecords && history) {
    // Material unless the company declares no AI use and nothing in the repository says otherwise.
    const anySignal = hasDirectSignals || agentConfigFiles.length > 0 || headerByPath.size > 0 || editorByCommit.size > 0;
    unknowns.add(
      'ai_development',
      'Which specific lines were written by AI tools',
      'No git-ai notes (refs/notes/ai) or Agent Trace records were found. Commit trailers, where present, only say a tool took part in a commit.',
      'Adopt git-ai or an Agent Trace-emitting agent and push refs/notes/* with the code; supply existing trace exports.',
      !(declarations?.aiUsage === 'none' && !anySignal),
    );
  }
  if (!history) {
    unknowns.add(
      'ai_development',
      'All AI development evidence',
      'The source has no git history (e.g. a ZIP upload), so commit metadata, notes and review evidence are unavailable.',
      'Analyse the git repository instead of an archive.',
    );
  }

  // ---------------------------------------------------------------- editor-inserted trailers
  const declaredNone = declarations?.aiUsage === 'none';
  if (editorByCommit.size) {
    const dates = [...editorByCommit.keys()].map((id) => history?.byId.get(id)?.author.date).filter((d): d is string => !!d).sort();
    const onlyEditor = [...editorByCommit.keys()].filter((id) => !signalsByCommit.has(id)).length;
    findings.add({
      rule: 'AI-013',
      state: 'INFERRED',
      summary: `${editorByCommit.size} commit(s)${dates.length ? ` (${dates[0]!.slice(0, 10)} to ${dates.at(-1)!.slice(0, 10)})` : ''} carry the "Co-authored-by: Copilot <copilot@github.com>" trailer that the VS Code editor inserts; ${onlyEditor} have no other AI signal. It is counted as corroborating only: some VS Code versions added it to commits with no AI involvement, and it also marks single suggested words.${declaredNone ? ' The company declares no AI use; these trailers alone neither confirm nor contradict that.' : ''}`,
      evidence: editorEvidence.slice(0, 60),
      fingerprint: 'editor-trailer',
    });
  }

  // ---------------------------------------------------------------- declarations vs evidence
  if (declaredNone && (hasDirect || agentConfigFiles.length)) {
    findings.add({
      rule: 'AI-002',
      state: 'CONFLICTING',
      summary: `The company declared that no AI coding tools were used, but the repository records ${aiCommitIds.size} AI-attributed commit(s)${agentConfigFiles.length ? ` and ${agentConfigFiles.length} AI tool configuration file(s)` : ''}.`,
      evidence: [...signalEvidence.values()].flat().slice(0, 40),
      fingerprint: 'declared-none',
    });
    contradictions++;
  }
  for (const d of declarations?.origins ?? []) {
    const matched = considered.filter((f) => matchesAny(f.path, d.paths));
    const declId = evidence.add({
      kind: 'declaration.origin',
      detector: DETECTOR.decl,
      state: 'USER_ASSERTED',
      locator: { source: declarations!.source },
      extract: `${d.paths.join(', ')} → ${d.origin}${d.statement ? `: ${d.statement}` : ''}`,
      attributes: { origin: d.origin, declaredOn: d.declaredOn ?? null, by: d.by ?? null, files: matched.length },
    });
    if (d.origin === 'human') {
      const clashing = matched.filter((f) => f.ai && (f.ai.category === 'direct_line' || f.ai.category === 'direct_commit'));
      if (clashing.length) {
        contradictions++;
        for (const f of clashing) f.ai!.state = 'CONFLICTING';
        findings.add({
          rule: 'AI-002',
          state: 'CONFLICTING',
          summary: `Declared as written by people (${d.paths.join(', ')}), but ${clashing.length} matching file(s) carry AI attribution (e.g. ${clashing.slice(0, 3).map((f) => f.path).join(', ')}).`,
          evidence: [declId, ...clashing.flatMap((f) => f.ai?.evidence ?? []).slice(0, 40)],
          fingerprint: `origin:${d.paths.join('|')}`,
        });
      }
    }
    if (d.origin === 'ai_generated') {
      const clashing = matched.filter((f) => f.ai && (f.ai.humanLines ?? 0) > 0 && (f.ai.aiLines ?? 0) === 0);
      if (clashing.length) {
        contradictions++;
        findings.add({
          rule: 'AI-002',
          state: 'CONFLICTING',
          summary: `Declared as AI-generated (${d.paths.join(', ')}), but line-level records attribute ${clashing.length} matching file(s) to people only.`,
          evidence: [declId, ...clashing.flatMap((f) => f.ai?.evidence ?? []).slice(0, 40)],
          fingerprint: `origin-ai:${d.paths.join('|')}`,
        });
      }
    }
    // A declaration older than the latest change to the files it covers no longer speaks to them.
    if (d.declaredOn && history) {
      const stale = matched.filter((f) => {
        const last = history.commitsByPath.get(f.path)?.[0];
        return last && last.author.date.slice(0, 10) > d.declaredOn!;
      });
      if (stale.length) {
        findings.add({
          rule: 'EVQ-002',
          state: 'STALE',
          summary: `The origin declaration for ${d.paths.join(', ')} is dated ${d.declaredOn}; ${stale.length} matching file(s) changed after that date (e.g. ${stale.slice(0, 3).map((f) => f.path).join(', ')}).`,
          evidence: [declId],
          fingerprint: `stale:${d.paths.join('|')}`,
        });
      }
    }
  }

  if (unverifiable) {
    findings.add({
      rule: 'AI-004',
      state: 'UNVERIFIABLE',
      summary: `${unverifiable} attribution record(s) could not be checked against the repository (unknown revision, missing file or out-of-range lines) and carry no weight.`,
      evidence: records.filter((r) => r.state === 'UNVERIFIABLE').slice(0, 50).map((r) => r.evidenceId),
      fingerprint: 'unverifiable',
    });
  }

  // Model artifacts: provenance of weights and training data is outside the repository.
  const weights = ctx.files.filter((f) => f.classes.includes('binary') && /\.(pt|pth|onnx|safetensors|h5|ckpt|gguf|tflite|mlmodel|joblib|pkl)$/i.test(f.path));
  if (weights.length) {
    findings.add({
      rule: 'AI-012',
      state: 'OBSERVED',
      summary: `${weights.length} model artifact(s) are committed (e.g. ${weights.slice(0, 3).map((f) => f.path).join(', ')}). Their training data, license and origin cannot be established from the repository.`,
      evidence: weights.slice(0, 30).map((f) =>
        evidence.add({ kind: 'file.model_artifact', detector: 'ai.model_artifact@1', state: 'OBSERVED', locator: { path: f.path }, attributes: { size: f.size, sha256: f.sha256 } }),
      ),
      fingerprint: 'weights',
    });
  }

  const summary: AiEvidenceSummary = {
    filesConsidered: considered.length,
    files: counts,
    lines: {
      blamedFiles: blamed,
      blameComplete: needBlame ? blameComplete : true,
      total: needBlame ? totalLines : null,
      aiAttributed: haveLineRecords ? aiLines : null,
      humanAttributed: haveLineRecords ? humanLines : null,
      fromAiAttributedCommits: history ? (needBlame ? linesFromAiCommits : 0) : null,
    },
    commits: {
      total: history?.commits.length ?? 0,
      withDirectEvidence: directCommits.length,
      withEditorTrailerOnly: [...editorByCommit.keys()].filter((id) => !aiCommitIds.has(id)).length,
      directEvidenceViaPullRequest: viaPr.length,
      directEvidencePushedDirectly: pushed.length,
    },
    reviews: { approvedByOther, notApproved, unknown: reviewUnknown, source: reviewSource },
    repoSignals: { agentConfigFiles: agentConfigFiles.sort(), firstAgentConfigAt },
    contradictions,
    unverifiable,
    tools: toolList,
  };
  return { summary, commitSignals: commitLabels, reviews };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
