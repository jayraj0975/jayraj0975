import { canonicalJson, sha256Hex, sortBy, stableId } from './canonical.js';
import {
  DEFAULT_LIMITS,
  EvidenceStore,
  FindingSink,
  UnknownSink,
  type AnalyzeOptions,
  type Limits,
  type RepoContext,
} from './context.js';
import { DeclarationError, parseDeclarations, type Declarations } from './declarations.js';
import type {
  AiEvidenceSummary,
  AiToolUse,
  CommitSummary,
  Component,
  Contributor,
  Coverage,
  Dependency,
  Dossier,
  EvidenceItem,
  FileEntry,
  Finding,
  Inventory,
  RepositorySubject,
  UnknownItem,
} from './model.js';
import type { RepoSource } from './source.js';
import type { ForgeProvider, EnrichmentCache } from './enrich/types.js';
import { Enricher } from './enrich/apply.js';
import { loadHistory } from './analyzers/history.js';
import {
  agentConfigTool,
  baseClasses,
  binaryKindByMagic,
  binaryKindByName,
  generatedHeaderMarker,
  languageOf,
  looksMinified,
  parseGitattributes,
} from './analyzers/classify.js';
import { analyzeAi, type SuppliedTrace } from './analyzers/ai.js';
import { analyzeDependencies } from './analyzers/dependencies.js';
import { analyzeProjectLicense, dependencyLicenseFindings, summarizeLicenses } from './analyzers/licenses.js';
import { analyzeThirdPartyCode } from './analyzers/thirdparty.js';
import { analyzeSecrets } from './analyzers/secrets.js';
import { analyzeCi } from './analyzers/ci.js';
import { analyzeOwnership } from './analyzers/ownership.js';
import { analyzeAiDependency, analyzeInventory } from './analyzers/maintainability.js';
import { computeReadiness, evaluateQuestions } from './diligence/questions.js';
import { buildSummary } from './diligence/summary.js';
import { ANALYZER_NAME, ANALYZER_VERSION, DOSSIER_SCHEMA, RULES_VERSION } from './version.js';
import { countLines, looksBinary, stripBom } from './util/text.js';
import { combineAny } from './states.js';
import { redactSecrets } from './analyzers/secrets.js';
import { checkInvariants, InvariantViolation } from './invariants.js';

export interface RepositoryInput {
  source: RepoSource;
  forge?: ForgeProvider;
  agentTraces?: SuppliedTrace[];
}

interface RepoAnalysis {
  subject: RepositorySubject;
  files: FileEntry[];
  commits: CommitSummary[];
  contributors: Contributor[];
  registerSupplied: boolean;
  historyCoverage: string;
  ai: AiEvidenceSummary;
  components: Component[];
  dependencies: Dependency[];
  project: ReturnType<typeof analyzeProjectLicense>;
  inventory: Inventory;
  findings: Finding[];
  unknowns: UnknownItem[];
  evidence: EvidenceItem[];
  coverage: Omit<Coverage, 'enrichment'>;
  metrics: Record<string, number | null>;
  aiProviders: string[];
  declarations: Declarations | null;
  hasHistory: boolean;
}

export async function analyze(inputs: RepositoryInput[], options: AnalyzeOptions = {}): Promise<Dossier> {
  if (!inputs.length) throw new Error('analyze: at least one repository is required');
  const names = inputs.map((i) => i.source.name);
  if (new Set(names).size !== names.length) throw new Error('analyze: repository names must be unique');
  const limits: Limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const enricher = new Enricher(options.enrichment ?? {});
  const multi = inputs.length > 1;
  const analyses: RepoAnalysis[] = [];
  for (const input of sortBy(inputs, (i) => i.source.name)) {
    analyses.push(await analyzeRepository(input, options, limits, enricher, multi));
  }
  return assemble(analyses, options, limits, enricher);
}

async function analyzeRepository(input: RepositoryInput, options: AnalyzeOptions, limits: Limits, enricher: Enricher, multi: boolean): Promise<RepoAnalysis> {
  const source = input.source;
  const repoTag = multi ? source.name : undefined;
  const evidence = new EvidenceStore(repoTag, options.omitExtracts ?? false);
  const findings = new FindingSink(repoTag);
  const unknowns = new UnknownSink(repoTag);

  // ---- snapshot
  let entries = await source.list();
  const filesTotal = entries.length;
  if (entries.length > limits.maxFiles) entries = sortBy(entries, (e) => e.path).slice(0, limits.maxFiles);
  const text = new Map<string, string>();
  const files: FileEntry[] = [];
  const skipped: Record<string, number> = {};
  let bytesScanned = 0;
  // Decide up front which files' content is held for scanning (smallest paths first is not needed: path order is deterministic).
  const keepSet = new Set<string>();
  let budget = limits.maxTotalContentBytes;
  for (const e of sortBy(entries, (x) => x.path)) {
    if (e.mode === 'submodule' || e.size > limits.maxFileBytes || e.size > budget) continue;
    keepSet.add(e.path);
    budget -= e.size;
  }
  await source.readAll(
    entries,
    (e) => keepSet.has(e.path),
    ({ entry, sha256, content }) => {
      const fe: FileEntry = { path: entry.path, sha256, size: entry.size, classes: [] };
      if (entry.objectId && entry.mode !== 'submodule') fe.blob = entry.objectId;
      const lang = languageOf(entry.path);
      if (lang) fe.language = lang;
      if (entry.mode === 'submodule') {
        fe.classes = ['submodule'];
        fe.contentSkipped = 'submodule';
        fe.sha256 = entry.objectId ?? sha256;
      } else if (entry.mode === 'symlink') {
        fe.classes = ['symlink'];
        fe.contentSkipped = 'symlink';
      } else if (!content) {
        fe.classes = baseClasses(entry.path);
        const kind = binaryKindByName(entry.path);
        if (kind) fe.classes.push(kind === 'asset' ? 'asset' : 'binary');
        fe.contentSkipped = entry.size > limits.maxFileBytes ? 'too_large' : 'limit';
      } else if (looksBinary(content)) {
        fe.classes = baseClasses(entry.path);
        const kind = binaryKindByMagic(content.subarray(0, 16)) ?? binaryKindByName(entry.path);
        fe.classes.push(kind === 'asset' ? 'asset' : 'binary');
        fe.contentSkipped = 'binary';
      } else {
        const t = stripBom(content.toString('utf8'));
        text.set(entry.path, t);
        bytesScanned += content.length;
        fe.lines = countLines(t);
        fe.classes = baseClasses(entry.path);
      }
      if (fe.contentSkipped) skipped[fe.contentSkipped] = (skipped[fe.contentSkipped] ?? 0) + 1;
      files.push(fe);
    },
  );
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fileIndex = new Map(files.map((f) => [f.path, f]));

  // .gitattributes and content-based generated detection
  const attrs = text.get('.gitattributes') ? parseGitattributes(text.get('.gitattributes')!) : null;
  for (const f of files) {
    const add = (c: FileEntry['classes'][number]) => {
      if (!f.classes.includes(c)) f.classes.push(c);
    };
    if (attrs) {
      if (attrs.generated.some((re) => re.test(f.path)) && !attrs.notGenerated.some((re) => re.test(f.path))) add('generated');
      if (attrs.vendored.some((re) => re.test(f.path))) add('vendored');
      if (attrs.documentation.some((re) => re.test(f.path))) add('docs');
    }
    const t = text.get(f.path);
    if (t !== undefined && !f.classes.includes('generated')) {
      if (generatedHeaderMarker(t) || looksMinified(f.path, t)) add('generated');
    }
    f.classes.sort();
    if (!f.classes.length) f.classes = ['other'];
  }

  // ---- history
  let history = null;
  if (source.git && source.commit) {
    history = await loadHistory(source.git, source.commit, limits.maxCommits);
    for (const f of files) {
      const newest = history.commitsByPath.get(f.path)?.[0];
      if (newest) f.lastCommit = newest.id;
    }
  }

  // ---- declarations
  let declarations: Declarations | null = options.declarations ?? null;
  if (!declarations) {
    const declText = text.get('acquicode.yml') ?? text.get('.acquicode.yml');
    if (declText !== undefined) {
      const path = text.has('acquicode.yml') ? 'acquicode.yml' : '.acquicode.yml';
      try {
        declarations = parseDeclarations(declText, `${source.name}:${path}`);
      } catch (err) {
        const msg = err instanceof DeclarationError ? err.message : 'unreadable';
        evidence.add({ kind: 'declaration.invalid', detector: 'declarations.parse@1', state: 'OBSERVED', locator: { path }, extract: msg, attributes: {} });
        unknowns.add('evidence_quality', `Company declarations in ${path}`, `The declarations file could not be used: ${msg}.`, 'Fix the declarations file (see docs/PROVENANCE.md).');
      }
    }
  }

  const ctx: RepoContext = { repoName: source.name, source, limits, options, files, fileIndex, text, history, evidence, findings, unknowns, declarations };

  // ---- analyzers (order matters only where one reads another's output)
  const ownership = analyzeOwnership(ctx);
  const deps = analyzeDependencies(ctx);
  const project = analyzeProjectLicense(ctx);
  analyzeThirdPartyCode(ctx);
  const secrets = await analyzeSecrets(ctx);
  const ci = analyzeCi(ctx);
  const inv = analyzeInventory(ctx);
  const aiDep = analyzeAiDependency(ctx, deps.dependencies);
  await enricher.enrich(ctx, deps.dependencies);
  dependencyLicenseFindings(ctx, deps.dependencies);
  const ai = await analyzeAi(ctx, input.agentTraces ?? [], enricher.forgeFor(input.forge));

  if (source.git && (await source.git.isDirty())) {
    findings.add({ rule: 'EVQ-003', state: 'OBSERVED', summary: `The working copy has uncommitted changes; this dossier describes commit ${source.commit?.slice(0, 12)} only.`, evidence: [], fingerprint: 'dirty' });
  }

  // ---- submodule inventory
  const submodules: Inventory['submodules'] = [];
  const gm = text.get('.gitmodules');
  const urls = new Map<string, string>();
  if (gm) {
    let current: string | null = null;
    for (const line of gm.split('\n')) {
      const p = /^\s*path\s*=\s*(.+)$/.exec(line);
      if (p) current = p[1]!.trim();
      const u = /^\s*url\s*=\s*(.+)$/.exec(line);
      if (u && current) urls.set(current, u[1]!.trim().replace(/\/\/[^@/]+@/, '//'));
    }
  }
  for (const f of files.filter((x) => x.contentSkipped === 'submodule')) submodules.push({ path: f.path, url: urls.get(f.path) ?? null, commit: f.sha256 });

  const inventory: Inventory = {
    ...inv,
    submodules,
    manifests: deps.manifests,
    lockfiles: deps.lockfiles,
    ciSystems: ci.systems,
    containerFiles: ci.containerFiles,
    agentConfigFiles: files.filter((f) => agentConfigTool(f.path)).map((f) => f.path),
  };

  // ---- suppressions and finding finalisation
  const allFindings = findings.all();
  for (const f of allFindings) {
    // Blocking requires observed or verified evidence. Inference can raise questions, never block.
    if (f.materiality === 'blocking' && f.state !== 'OBSERVED' && f.state !== 'VERIFIED') f.materiality = 'material';
    const sup = declarations?.suppressions.find((s) => s.rule === f.rule && s.fingerprint === f.fingerprint);
    if (sup) f.suppressed = { reason: sup.reason, by: sup.by ?? 'company', state: 'USER_ASSERTED' };
  }

  const subject: RepositorySubject = {
    name: source.name,
    kind: source.kind,
    contentDigest: sha256Hex(canonicalJson(files.map((f) => [f.path, f.sha256]))),
  };
  if (source.git && source.commit) {
    subject.headCommit = source.commit;
    subject.treeId = await source.git.treeId(source.commit);
    const remote = await source.git.remoteUrl();
    if (remote) subject.remote = remote;
    const branch = await source.git.currentBranch();
    if (branch) subject.branch = branch;
  }

  // Commits carried into the dossier: AI-attributed, root, and the newest 500.
  const commits: CommitSummary[] = [];
  if (history) {
    const labels = ai.commitSignals;
    history.commits.forEach((c, i) => {
      const signals = labels.get(c.id) ?? [];
      if (!(i < 500 || signals.length || history!.roots.includes(c.id))) return;
      const cs: CommitSummary = {
        sha: c.id,
        parents: c.parents,
        authorName: c.author.name,
        authorEmail: c.author.email,
        authoredAt: c.author.date,
        committerName: c.committer.name,
        committerEmail: c.committer.email,
        committedAt: c.committer.date,
        signed: c.signed,
        subject: redactSecrets(c.subject.slice(0, 300)),
        trailers: c.trailers.slice(0, 20).map(([k, v]) => [k, redactSecrets(v.slice(0, 200))] as [string, string]),
        filesChanged: c.changes.length,
        linesAdded: c.changes.reduce((s, ch) => s + (ch.added ?? 0), 0),
        linesDeleted: c.changes.reduce((s, ch) => s + (ch.deleted ?? 0), 0),
        pullRequest: c.pullRequest,
        aiSignals: signals,
      };
      if (repoTag) cs.repository = repoTag;
      commits.push(cs);
    });
  }

  const metrics: Record<string, number | null> = {
    ...ownership.metrics,
    files: files.length,
    sourceFiles: files.filter((f) => f.classes.includes('source') && !f.classes.includes('vendored') && !f.classes.includes('generated')).length,
    testFiles: files.filter((f) => f.classes.includes('test') && !f.classes.includes('vendored')).length,
    sourceLines: files.filter((f) => f.classes.includes('source') && !f.classes.includes('vendored') && !f.classes.includes('generated')).reduce((s, f) => s + (f.lines ?? 0), 0),
    dependencies: deps.dependencies.length,
    directDependencies: deps.dependencies.filter((d) => d.direct).length,
    productionDependencies: deps.dependencies.filter((d) => d.scope !== 'development').length,
    privateDependencies: deps.dependencies.filter((d) => d.private).length,
    secretsInCurrentCode: secrets.headMatches,
    secretsInHistoryOnly: secrets.historyOnly,
  };

  return {
    subject,
    files,
    commits,
    contributors: ownership.contributors,
    registerSupplied: ownership.registerSupplied,
    historyCoverage: ownership.historyCoverage,
    ai: ai.summary,
    components: deps.components,
    dependencies: deps.dependencies,
    project,
    inventory,
    findings: allFindings,
    unknowns: unknowns.all(),
    evidence: evidence.all(),
    coverage: {
      filesTotal,
      filesContentScanned: text.size,
      filesSkipped: skipped,
      bytesScanned,
      history: {
        available: !!history,
        shallow: history?.shallow ?? false,
        commitsAnalyzed: history?.commits.length ?? 0,
        commitsTotal: history ? history.total : null,
        truncated: history?.truncated ?? false,
        rootCommits: history?.roots.length ?? 0,
        notesRefs: history?.notesRefs ?? [],
      },
      secretsHistoryScan: { performed: secrets.performed, blobsScanned: secrets.blobsScanned, truncated: secrets.truncated },
      blame: { filesBlamed: ai.summary.lines.blamedFiles, truncated: !ai.summary.lines.blameComplete },
      limits: { ...limits },
    },
    metrics,
    aiProviders: aiDep.providers,
    declarations,
    hasHistory: !!history,
  };
}

function mergeAi(list: AiEvidenceSummary[]): AiEvidenceSummary {
  if (list.length === 1) return list[0]!;
  const sumNull = (vals: Array<number | null>) => (vals.every((v) => v === null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0));
  const tools = new Map<string, AiToolUse>();
  for (const s of list) {
    for (const t of s.tools) {
      const e = tools.get(t.tool);
      if (!e) tools.set(t.tool, { ...t, models: [...t.models], signals: [...t.signals] });
      else {
        e.commits += t.commits;
        e.models = [...new Set([...e.models, ...t.models])].sort();
        e.signals = [...new Set([...e.signals, ...t.signals])].sort();
        if (t.firstSeen && (!e.firstSeen || t.firstSeen < e.firstSeen)) e.firstSeen = t.firstSeen;
        if (t.lastSeen && (!e.lastSeen || t.lastSeen > e.lastSeen)) e.lastSeen = t.lastSeen;
        e.state = combineAny([e.state, t.state]);
      }
    }
  }
  const agentConfigFiles = list.flatMap((s) => s.repoSignals.agentConfigFiles);
  const firsts = list.map((s) => s.repoSignals.firstAgentConfigAt).filter((x): x is string => !!x).sort();
  return {
    filesConsidered: list.reduce((s, x) => s + x.filesConsidered, 0),
    files: {
      direct_line: list.reduce((s, x) => s + x.files.direct_line, 0),
      direct_commit: list.reduce((s, x) => s + x.files.direct_commit, 0),
      corroborating: list.reduce((s, x) => s + x.files.corroborating, 0),
      inference: list.reduce((s, x) => s + x.files.inference, 0),
      none: list.reduce((s, x) => s + x.files.none, 0),
      humanRecorded: list.reduce((s, x) => s + x.files.humanRecorded, 0),
    },
    lines: {
      blamedFiles: list.reduce((s, x) => s + x.lines.blamedFiles, 0),
      blameComplete: list.every((x) => x.lines.blameComplete),
      total: sumNull(list.map((x) => x.lines.total)),
      aiAttributed: sumNull(list.map((x) => x.lines.aiAttributed)),
      humanAttributed: sumNull(list.map((x) => x.lines.humanAttributed)),
      fromAiAttributedCommits: sumNull(list.map((x) => x.lines.fromAiAttributedCommits)),
    },
    commits: {
      total: list.reduce((s, x) => s + x.commits.total, 0),
      withDirectEvidence: list.reduce((s, x) => s + x.commits.withDirectEvidence, 0),
      directEvidenceViaPullRequest: list.reduce((s, x) => s + x.commits.directEvidenceViaPullRequest, 0),
      directEvidencePushedDirectly: list.reduce((s, x) => s + x.commits.directEvidencePushedDirectly, 0),
    },
    reviews: {
      approvedByOther: list.reduce((s, x) => s + x.reviews.approvedByOther, 0),
      notApproved: list.reduce((s, x) => s + x.reviews.notApproved, 0),
      unknown: list.reduce((s, x) => s + x.reviews.unknown, 0),
      source: list.some((x) => x.reviews.source === 'forge') ? 'forge' : 'none',
    },
    repoSignals: { agentConfigFiles, firstAgentConfigAt: firsts[0] ?? null },
    contradictions: list.reduce((s, x) => s + x.contradictions, 0),
    unverifiable: list.reduce((s, x) => s + x.unverifiable, 0),
    tools: sortBy([...tools.values()], (t) => t.tool),
  };
}

function mergeContributors(analyses: RepoAnalysis[]): Contributor[] {
  if (analyses.length === 1) return analyses[0]!.contributors;
  const out: Contributor[] = [];
  const byEmail = new Map<string, Contributor>();
  for (const a of analyses) {
    for (const c of a.contributors) {
      const match = c.identities.map((i) => byEmail.get(i.email)).find((x) => x);
      if (!match) {
        const copy: Contributor = { ...c, identities: [...c.identities], repositories: [...c.repositories] };
        out.push(copy);
        for (const i of c.identities) if (i.email) byEmail.set(i.email, copy);
        continue;
      }
      match.commits += c.commits;
      match.linesAdded += c.linesAdded;
      match.linesDeleted += c.linesDeleted;
      match.filesTouched += c.filesTouched;
      if (c.firstCommitAt < match.firstCommitAt) match.firstCommitAt = c.firstCommitAt;
      if (c.lastCommitAt > match.lastCommitAt) match.lastCommitAt = c.lastCommitAt;
      match.repositories = [...new Set([...match.repositories, ...c.repositories])].sort();
      for (const i of c.identities) {
        if (!match.identities.some((x) => x.email === i.email && x.name === i.name)) match.identities.push(i);
        if (i.email) byEmail.set(i.email, match);
      }
      match.identities = sortBy(match.identities, (i) => i.email, (i) => i.name);
      match.id = stableId('ctb', match.identities.map((i) => i.email || i.name).sort());
    }
  }
  return sortBy(out, (c) => -c.commits, (c) => c.id);
}

function assemble(analyses: RepoAnalysis[], options: AnalyzeOptions, limits: Limits, enricher: Enricher): Dossier {
  const multi = analyses.length > 1;
  const findings = sortBy(
    analyses.flatMap((a) => a.findings),
    (f) => ['blocking', 'material', 'minor', 'info'].indexOf(f.materiality),
    (f) => f.rule,
    (f) => f.id,
  );
  const unknowns = sortBy(analyses.flatMap((a) => a.unknowns), (u) => u.area, (u) => (u.material ? 0 : 1), (u) => u.id);
  const evidence = sortBy(analyses.flatMap((a) => a.evidence), (e) => e.id);
  const dependencies = analyses.flatMap((a) => a.dependencies);
  const components = sortBy(analyses.flatMap((a) => a.components), (c) => c.repository ?? '', (c) => c.manifestPath);
  const contributors = mergeContributors(analyses);
  const ai = mergeAi(analyses.map((a) => a.ai));
  const project = analyses[0]!.project;
  const licenses = summarizeLicenses(project, dependencies);
  const declarations = analyses.find((a) => a.declarations)?.declarations ?? null;
  const coverage: Coverage = {
    filesTotal: analyses.reduce((s, a) => s + a.coverage.filesTotal, 0),
    filesContentScanned: analyses.reduce((s, a) => s + a.coverage.filesContentScanned, 0),
    filesSkipped: analyses.reduce<Record<string, number>>((acc, a) => {
      for (const [k, v] of Object.entries(a.coverage.filesSkipped)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
    bytesScanned: analyses.reduce((s, a) => s + a.coverage.bytesScanned, 0),
    history: {
      available: analyses.every((a) => a.coverage.history.available),
      shallow: analyses.some((a) => a.coverage.history.shallow),
      commitsAnalyzed: analyses.reduce((s, a) => s + a.coverage.history.commitsAnalyzed, 0),
      commitsTotal: analyses.every((a) => a.coverage.history.commitsTotal !== null) ? analyses.reduce((s, a) => s + (a.coverage.history.commitsTotal ?? 0), 0) : null,
      truncated: analyses.some((a) => a.coverage.history.truncated),
      rootCommits: analyses.reduce((s, a) => s + a.coverage.history.rootCommits, 0),
      notesRefs: [...new Set(analyses.flatMap((a) => a.coverage.history.notesRefs))].sort(),
    },
    secretsHistoryScan: {
      performed: analyses.every((a) => a.coverage.secretsHistoryScan.performed),
      blobsScanned: analyses.reduce((s, a) => s + a.coverage.secretsHistoryScan.blobsScanned, 0),
      truncated: analyses.some((a) => a.coverage.secretsHistoryScan.truncated),
    },
    blame: { filesBlamed: analyses.reduce((s, a) => s + a.coverage.blame.filesBlamed, 0), truncated: analyses.some((a) => a.coverage.blame.truncated) },
    enrichment: enricher.records(),
    limits: { ...limits },
  };

  const inventory: Inventory = multi
    ? {
        languages: sortBy(
          Object.values(
            analyses.flatMap((a) => a.inventory.languages).reduce<Record<string, { language: string; files: number; lines: number }>>((acc, l) => {
              const e = (acc[l.language] ??= { language: l.language, files: 0, lines: 0 });
              e.files += l.files;
              e.lines += l.lines;
              return acc;
            }, {}),
          ),
          (l) => -l.lines,
          (l) => l.language,
        ),
        classes: analyses.reduce((acc, a) => {
          for (const [k, v] of Object.entries(a.inventory.classes)) acc[k as keyof Inventory['classes']] = (acc[k as keyof Inventory['classes']] ?? 0) + v;
          return acc;
        }, {} as Inventory['classes']),
        manifests: analyses.flatMap((a) => a.inventory.manifests.map((m) => `${a.subject.name}/${m}`)),
        lockfiles: analyses.flatMap((a) => a.inventory.lockfiles.map((m) => `${a.subject.name}/${m}`)),
        submodules: analyses.flatMap((a) => a.inventory.submodules.map((s) => ({ ...s, path: `${a.subject.name}/${s.path}` }))),
        vendoredRoots: analyses.flatMap((a) => a.inventory.vendoredRoots.map((v) => `${a.subject.name}/${v}`)),
        generatedFiles: analyses.reduce((s, a) => s + a.inventory.generatedFiles, 0),
        binaries: analyses.flatMap((a) => a.inventory.binaries.map((b) => ({ ...b, path: `${a.subject.name}/${b.path}` }))),
        ciSystems: [...new Set(analyses.flatMap((a) => a.inventory.ciSystems))].sort(),
        containerFiles: analyses.flatMap((a) => a.inventory.containerFiles.map((c) => `${a.subject.name}/${c}`)),
        agentConfigFiles: analyses.flatMap((a) => a.inventory.agentConfigFiles.map((c) => `${a.subject.name}/${c}`)),
        branches: analyses.flatMap((a) => a.inventory.branches.map((b) => `${a.subject.name}:${b}`)),
        tags: analyses.flatMap((a) => a.inventory.tags.map((t) => `${a.subject.name}:${t}`)),
      }
    : analyses[0]!.inventory;

  const questions = evaluateQuestions({
    findings,
    unknowns,
    ai,
    licenses,
    dependencies,
    contributors,
    registerSupplied: analyses.every((a) => a.registerSupplied),
    hasHistory: analyses.every((a) => a.hasHistory),
    coverage,
    declarations,
    aiProviders: [...new Set(analyses.flatMap((a) => a.aiProviders))].sort(),
  });
  const readiness = computeReadiness(questions, findings, unknowns);

  const metrics: Record<string, number | null> = {};
  for (const a of analyses) {
    for (const [k, v] of Object.entries(a.metrics)) {
      if (v === null) metrics[k] ??= null;
      else metrics[k] = (metrics[k] ?? 0) + v;
    }
  }
  if (multi) {
    // Ratios and person counts do not add across repositories.
    for (const k of ['busFactor', 'topContributorShare']) metrics[k] = null;
    const humans = contributors.filter((c) => c.class !== 'bot' && c.class !== 'ai_agent');
    metrics.contributorsHuman = humans.length;
    metrics.contributorsOrg = humans.filter((c) => c.class === 'org_domain' || c.class === 'org_domain_inferred').length;
    metrics.contributorsNonOrg = humans.length - (metrics.contributorsOrg ?? 0);
  }
  metrics.findingsBlocking = findings.filter((f) => !f.suppressed && f.materiality === 'blocking').length;
  metrics.findingsMaterial = findings.filter((f) => !f.suppressed && f.materiality === 'material').length;
  metrics.unknownsMaterial = unknowns.filter((u) => u.material).length;

  const recordedOptions: Dossier['options'] = {
    scanHistoryForSecrets: options.scanHistoryForSecrets ?? true,
    omitExtracts: options.omitExtracts ?? false,
    asOf: options.asOf ?? null,
    vulnerabilityEnrichment: !!options.enrichment?.vulnerabilities,
    registryEnrichment: !!options.enrichment?.registry,
  };

  const files = sortBy(
    analyses.flatMap((a) => (multi ? a.files.map((f) => ({ ...f, repository: a.subject.name })) : a.files)),
    (f) => f.repository ?? '',
    (f) => f.path,
  );
  const commits = analyses.flatMap((a) => a.commits);

  const dossier: Dossier = {
    schema: DOSSIER_SCHEMA,
    analyzer: { name: ANALYZER_NAME, version: ANALYZER_VERSION, rulesVersion: RULES_VERSION },
    title: options.title ?? (multi ? `${analyses.length} repositories` : analyses[0]!.subject.name),
    subjects: analyses.map((a) => a.subject),
    declarations: { supplied: !!declarations, digest: declarations?.digest ?? null, source: declarations?.source ?? null, distribution: declarations?.distribution ?? null, aiUsage: declarations?.aiUsage ?? null },
    options: recordedOptions,
    coverage,
    readiness,
    summary: { headline: '', paragraphs: [], counts: { blocking: 0, material: 0, minor: 0, info: 0 }, topFindings: [] },
    inventory,
    ownership: { contributors, registerSupplied: analyses.every((a) => a.registerSupplied), historyCoverage: analyses.map((a) => (multi ? `${a.subject.name}: ${a.historyCoverage}` : a.historyCoverage)).join('; ') },
    aiDevelopment: ai,
    components,
    dependencies: sortBy(dependencies, (d) => d.repository ?? '', (d) => d.component, (d) => d.name, (d) => d.version ?? ''),
    licenses,
    metrics: Object.fromEntries(Object.entries(metrics).sort(([a], [b]) => (a < b ? -1 : 1))),
    findings,
    questions,
    unknowns,
    evidence,
    files,
    commits,
    enrichment: enricher.cache,
  };
  dossier.summary = buildSummary(dossier);
  const violations = checkInvariants(dossier);
  if (violations.length) throw new InvariantViolation(violations);
  return dossier;
}

/** sha256 of the canonical dossier: the value a verifier reproduces. */
export function dossierDigest(d: Dossier): string {
  return sha256Hex(canonicalJson(d));
}

export type { EnrichmentCache };
