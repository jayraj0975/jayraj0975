import { stableId } from './canonical.js';
import type { Declarations } from './declarations.js';
import type {
  EvidenceClass,
  EvidenceItem,
  FileEntry,
  Finding,
  Locator,
  Materiality,
  ProvenanceState,
  Scalar,
  UnknownItem,
  Area,
} from './model.js';
import { RULES, type RuleId } from './rules.js';
import type { RepoSource } from './source.js';
import type { History } from './analyzers/history.js';
import { safeExtract } from './util/text.js';
import { redactSecrets } from './analyzers/secrets.js';

export interface Limits {
  /** Files larger than this are hashed but their content is not scanned. */
  maxFileBytes: number;
  /** Total bytes of file content held for scanning. */
  maxTotalContentBytes: number;
  maxFiles: number;
  maxCommits: number;
  maxHistoryBlobs: number;
  maxHistoryBlobBytes: number;
  maxBlameFiles: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalContentBytes: 768 * 1024 * 1024,
  maxFiles: 400_000,
  maxCommits: 200_000,
  maxHistoryBlobs: 250_000,
  maxHistoryBlobBytes: 1024 * 1024,
  maxBlameFiles: 3_000,
};

export interface AnalyzeOptions {
  limits?: Partial<Limits>;
  /** Scan every blob in history for secrets (default true for git sources). */
  scanHistoryForSecrets?: boolean;
  /** Drop evidence extracts (structured values lifted from files) from the output. */
  omitExtracts?: boolean;
  /** Declarations supplied out-of-band (take precedence over an in-repo acquicode.yml). */
  declarations?: Declarations | null;
  /** Enrichment providers; when absent the corresponding sections are UNKNOWN. */
  enrichment?: import('./enrich/types.js').EnrichmentProviders;
  /** Forge metadata (PR reviews etc.) when a forge API is connected. */
  forge?: import('./enrich/types.js').ForgeProvider;
  title?: string;
  /** Reference date for time-relative rules (e.g. inactivity). Recorded in the dossier; omitted means those rules do not run. */
  asOf?: string;
}

export class EvidenceStore {
  private readonly items = new Map<string, EvidenceItem>();
  constructor(
    private readonly repository: string | undefined,
    private readonly omitExtracts: boolean,
  ) {}

  add(input: {
    kind: string;
    detector: string;
    state: ProvenanceState;
    evidenceClass?: EvidenceClass;
    locator: Locator;
    extract?: string | null;
    attributes?: Record<string, Scalar | undefined>;
  }): string {
    const locator: Locator = { ...input.locator };
    if (this.repository && !locator.repository) locator.repository = this.repository;
    const attributes: Record<string, Scalar> = {};
    for (const [k, v] of Object.entries(input.attributes ?? {})) if (v !== undefined) attributes[k] = v;
    const extract = input.extract && !this.omitExtracts ? redactSecrets(safeExtract(input.extract)) : undefined;
    const id = stableId('ev', input.kind, input.detector, locator, extract ?? null, attributes);
    if (!this.items.has(id)) {
      const item: EvidenceItem = { id, kind: input.kind, detector: input.detector, state: input.state, locator, attributes };
      if (input.evidenceClass) item.evidenceClass = input.evidenceClass;
      if (extract) item.extract = extract;
      this.items.set(id, item);
    }
    return id;
  }

  get(id: string): EvidenceItem | undefined {
    return this.items.get(id);
  }

  all(): EvidenceItem[] {
    return [...this.items.values()];
  }
}

export class FindingSink {
  private readonly items = new Map<string, Finding>();
  constructor(private readonly repository: string | undefined) {}

  add(input: {
    rule: RuleId;
    state: ProvenanceState;
    summary: string;
    evidence: string[];
    fingerprint: string;
    materiality?: Materiality;
    title?: string;
    component?: string;
  }): Finding {
    const def = RULES[input.rule];
    const fingerprint = stableId('fp', input.rule, this.repository ?? '', input.fingerprint);
    const id = stableId('fd', input.rule, this.repository ?? '', input.fingerprint);
    const existing = this.items.get(id);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...input.evidence])].sort();
      return existing;
    }
    const f: Finding = {
      id,
      rule: input.rule,
      ruleVersion: def.version,
      area: def.area,
      title: input.title ?? def.title,
      materiality: input.materiality ?? def.materiality,
      state: input.state,
      audience: [...def.audience],
      summary: redactSecrets(input.summary),
      evidence: [...new Set(input.evidence)].sort(),
      fingerprint,
    };
    if (this.repository) f.repository = this.repository;
    if (input.component) f.component = input.component;
    this.items.set(id, f);
    return f;
  }

  all(): Finding[] {
    return [...this.items.values()];
  }
}

export class UnknownSink {
  private readonly items = new Map<string, UnknownItem>();
  constructor(private readonly repository: string | undefined) {}

  add(area: Area, statement: string, why: string, resolveBy: string, material = true): string {
    const id = stableId('uk', area, this.repository ?? '', statement);
    if (!this.items.has(id)) {
      const scoped = this.repository ? `${this.repository}: ${statement}` : statement;
      this.items.set(id, { id, area, statement: scoped, why, resolveBy, material });
    }
    return id;
  }

  all(): UnknownItem[] {
    return [...this.items.values()];
  }
}

/** Everything analyzers share while processing one repository. */
export interface RepoContext {
  repoName: string;
  source: RepoSource;
  limits: Limits;
  options: AnalyzeOptions;
  files: FileEntry[];
  fileIndex: Map<string, FileEntry>;
  /** Decoded text content of scanned files. */
  text: Map<string, string>;
  history: History | null;
  evidence: EvidenceStore;
  findings: FindingSink;
  unknowns: UnknownSink;
  declarations: Declarations | null;
}
