/**
 * The evidence model. Every statement the dossier makes is a Claim, every Claim
 * points at EvidenceItems, and every EvidenceItem and Claim carries a
 * ProvenanceState. See docs/PROVENANCE.md.
 */

export const PROVENANCE_STATES = [
  'VERIFIED',
  'OBSERVED',
  'DERIVED',
  'USER_ASSERTED',
  'INFERRED',
  'UNKNOWN',
  'CONFLICTING',
  'UNVERIFIABLE',
  'STALE',
] as const;
export type ProvenanceState = (typeof PROVENANCE_STATES)[number];

/** How directly a piece of AI-origin evidence speaks to the code it is attached to. */
export type EvidenceClass = 'DIRECT' | 'CORROBORATING' | 'INFERENCE';

export type Audience = 'management' | 'counsel' | 'engineering';
export type Materiality = 'blocking' | 'material' | 'minor' | 'info';
export type Area =
  | 'ownership'
  | 'provenance'
  | 'ai_development'
  | 'licenses'
  | 'security'
  | 'reproducibility'
  | 'maintainability'
  | 'ai_dependency'
  | 'evidence_quality'
  | 'change_history';

export type Scalar = string | number | boolean | null;

export interface Locator {
  /** Repository-relative path, POSIX separators. */
  path?: string;
  line?: number;
  endLine?: number;
  commit?: string;
  /** For external sources (registries, advisories) and supplied documents. */
  source?: string;
  /** Repository name when a dossier covers several repositories. */
  repository?: string;
}

export interface EvidenceItem {
  id: string;
  /** e.g. "commit.trailer", "git_ai.note", "lockfile.entry", "file.license_text". */
  kind: string;
  /** Detector that produced it, "<rule>@<version>". */
  detector: string;
  state: ProvenanceState;
  evidenceClass?: EvidenceClass;
  locator: Locator;
  /**
   * A short structured value lifted from the artifact (license id, trailer value,
   * package@version, URL, copyright holder). Never source code, never secrets.
   */
  extract?: string;
  attributes: Record<string, Scalar>;
}

export interface Finding {
  id: string;
  rule: string;
  ruleVersion: number;
  area: Area;
  title: string;
  materiality: Materiality;
  /** State of the evidence that supports the finding. */
  state: ProvenanceState;
  audience: Audience[];
  summary: string;
  evidence: string[];
  repository?: string;
  component?: string;
  /** Stable identity across snapshots (for diffing and suppressions). */
  fingerprint: string;
  suppressed?: { reason: string; by: string; state: ProvenanceState };
}

export type QuestionStatus = 'SATISFIED' | 'ATTENTION' | 'BLOCKING' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface DiligenceAnswer {
  id: string;
  area: Area;
  question: string;
  status: QuestionStatus;
  state: ProvenanceState;
  rationale: string;
  findings: string[];
  unknowns: string[];
  followUps: FollowUp[];
}

export interface FollowUp {
  audience: Audience;
  text: string;
  /** Finding or unknown ids that prompted it. */
  basis: string[];
}

export interface UnknownItem {
  id: string;
  area: Area;
  statement: string;
  why: string;
  resolveBy: string;
  material: boolean;
}

export type Readiness = 'READY' | 'REVIEW' | 'BLOCKED';

// ---------------------------------------------------------------------------
// Entities

export type FileClass =
  | 'source'
  | 'test'
  | 'docs'
  | 'config'
  | 'manifest'
  | 'lockfile'
  | 'generated'
  | 'vendored'
  | 'binary'
  | 'asset'
  | 'symlink'
  | 'submodule'
  | 'other';

export interface FileEntry {
  path: string;
  /** Set when the dossier covers several repositories. */
  repository?: string;
  /** sha256 of content (hex). Submodules: the pinned commit. Symlinks: sha256 of target. */
  sha256: string;
  /** git blob id when the source is a git commit. */
  blob?: string;
  size: number;
  classes: FileClass[];
  language?: string;
  lines?: number;
  /** Content was not read (too large, binary, limit reached). */
  contentSkipped?: 'too_large' | 'binary' | 'limit' | 'submodule' | 'symlink';
  /** Newest commit that changed this path (git sources). */
  lastCommit?: string;
  ai?: FileAiStatus;
}

export interface ContributorIdentity {
  name: string;
  email: string;
}

export type ContributorClass =
  | 'org_domain'
  | 'org_domain_inferred'
  | 'personal_email'
  | 'forge_noreply'
  | 'external_domain'
  | 'bot'
  | 'ai_agent'
  | 'unknown';

export interface Contributor {
  id: string;
  displayName: string;
  identities: ContributorIdentity[];
  class: ContributorClass;
  classState: ProvenanceState;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  firstCommitAt: string;
  lastCommitAt: string;
  filesTouched: number;
  /** Identities merged by name only (not email) are INFERRED. */
  mergeState: ProvenanceState;
  agreement?: {
    type: string;
    signedOn?: string;
    entity?: string;
    state: ProvenanceState;
    matchedBy: 'email' | 'name';
  };
  repositories: string[];
}

export type DependencyScope = 'production' | 'development' | 'optional' | 'peer' | 'unknown';

export interface Dependency {
  id: string;
  ecosystem: string;
  name: string;
  version: string | null;
  /** Declared requirement in the manifest, when known. */
  requirement?: string;
  direct: boolean;
  scope: DependencyScope;
  component: string;
  repository?: string;
  source: 'lockfile' | 'manifest' | 'vendored';
  sourcePath: string;
  resolved?: string;
  integrity?: string;
  private: boolean;
  hasInstallScript?: boolean;
  license?: LicenseConclusion;
  evidence: string[];
}

export type LicenseCategory =
  | 'permissive'
  | 'weak_copyleft'
  | 'strong_copyleft'
  | 'network_copyleft'
  | 'source_available'
  | 'public_domain'
  | 'proprietary'
  | 'content'
  | 'unknown';

export type LicenseCertainty = 'KNOWN' | 'LIKELY' | 'UNKNOWN';

export interface LicenseConclusion {
  expression: string | null;
  certainty: LicenseCertainty;
  state: ProvenanceState;
  categories: LicenseCategory[];
  source: 'lockfile' | 'manifest' | 'license_file' | 'registry' | 'spdx_header' | 'none';
  evidence: string[];
}

export interface Component {
  id: string;
  name: string;
  ecosystem: string;
  manifestPath: string;
  lockfilePath: string | null;
  repository?: string;
  dependencyCount: { direct: number; transitive: number };
}

export interface AiToolUse {
  tool: string;
  vendor: string | null;
  models: string[];
  commits: number;
  firstSeen: string | null;
  lastSeen: string | null;
  signals: string[];
  state: ProvenanceState;
  /** From declarations: plan tier, indemnity, filters. */
  declared?: Record<string, Scalar>;
}

export interface CommitSummary {
  sha: string;
  repository?: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  /** Signature presence only; verification needs the signer's key or the forge API. */
  signed: boolean;
  pullRequest: number | null;
  aiSignals: string[];
  subject: string;
  trailers: Array<[string, string]>;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

export interface RepositorySubject {
  name: string;
  kind: 'git' | 'directory';
  remote?: string;
  headCommit?: string;
  treeId?: string;
  branch?: string;
  /** sha256 over the sorted (path, sha256) file table. */
  contentDigest: string;
}

export interface Coverage {
  filesTotal: number;
  filesContentScanned: number;
  filesSkipped: Record<string, number>;
  bytesScanned: number;
  history: {
    available: boolean;
    shallow: boolean;
    commitsAnalyzed: number;
    commitsTotal: number | null;
    truncated: boolean;
    rootCommits: number;
    notesRefs: string[];
  };
  secretsHistoryScan: { performed: boolean; blobsScanned: number; truncated: boolean };
  blame: { filesBlamed: number; truncated: boolean };
  enrichment: EnrichmentRecord[];
  limits: Record<string, number>;
}

export interface EnrichmentRecord {
  source: string;
  performed: boolean;
  reason?: string;
  queriedAt?: string;
  items: number;
  /** sha256 of the canonical response set, so a verifier can check the cache. */
  digest?: string;
}

export type AiFileCategory = 'direct_line' | 'direct_commit' | 'corroborating' | 'inference' | 'none';

export interface FileAiStatus {
  category: AiFileCategory;
  /** Surviving lines with line-level AI attribution (git-ai / Agent Trace). */
  aiLines?: number;
  /** Surviving lines with line-level human attribution. */
  humanLines?: number;
  /** Surviving lines that originate in commits carrying commit-level AI attribution. */
  linesFromAiCommits?: number;
  tools: string[];
  evidence: string[];
  state: ProvenanceState;
}

export interface AiEvidenceSummary {
  /** First-party text files (not vendored, generated, lockfile or binary). */
  filesConsidered: number;
  files: Record<AiFileCategory, number> & { humanRecorded: number };
  lines: {
    blamedFiles: number;
    blameComplete: boolean;
    total: number | null;
    aiAttributed: number | null;
    humanAttributed: number | null;
    fromAiAttributedCommits: number | null;
  };
  commits: {
    total: number;
    withDirectEvidence: number;
    /** Commits whose only AI signal is an editor-inserted trailer (corroborating, not attribution). */
    withEditorTrailerOnly: number;
    directEvidenceViaPullRequest: number;
    directEvidencePushedDirectly: number;
  };
  reviews: { approvedByOther: number; notApproved: number; unknown: number; source: 'forge' | 'none' };
  repoSignals: { agentConfigFiles: string[]; firstAgentConfigAt: string | null };
  contradictions: number;
  unverifiable: number;
  tools: AiToolUse[];
}

export interface Dossier {
  schema: 'acquicode.dossier/1';
  analyzer: { name: string; version: string; rulesVersion: string };
  title: string;
  subjects: RepositorySubject[];
  declarations: { supplied: boolean; digest: string | null; source: string | null; distribution: string | null; aiUsage: string | null };
  options: Record<string, Scalar>;
  coverage: Coverage;
  readiness: { level: Readiness; reasons: string[] };
  summary: ExecutiveSummary;
  inventory: Inventory;
  ownership: { contributors: Contributor[]; registerSupplied: boolean; historyCoverage: string };
  aiDevelopment: AiEvidenceSummary;
  components: Component[];
  dependencies: Dependency[];
  licenses: LicenseSummary;
  metrics: Record<string, number | null>;
  findings: Finding[];
  questions: DiligenceAnswer[];
  unknowns: UnknownItem[];
  evidence: EvidenceItem[];
  files: FileEntry[];
  commits: CommitSummary[];
  /** Recorded enrichment responses, so a verifier can replay them. */
  enrichment: import('./enrich/types.js').EnrichmentCache;
}

export interface ExecutiveSummary {
  headline: string;
  paragraphs: string[];
  counts: Record<Materiality, number>;
  topFindings: string[];
}

export interface Inventory {
  languages: Array<{ language: string; files: number; lines: number }>;
  classes: Record<FileClass, number>;
  manifests: string[];
  lockfiles: string[];
  submodules: Array<{ path: string; url: string | null; commit: string }>;
  vendoredRoots: string[];
  generatedFiles: number;
  binaries: Array<{ path: string; size: number; kind: string }>;
  ciSystems: string[];
  containerFiles: string[];
  agentConfigFiles: string[];
  branches: string[];
  tags: string[];
}

export interface LicenseSummary {
  project: LicenseConclusion & { files: string[] };
  byCategory: Record<LicenseCategory, number>;
  known: number;
  likely: number;
  unknown: number;
}
