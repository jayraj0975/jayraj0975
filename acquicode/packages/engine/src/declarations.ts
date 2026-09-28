import YAML from 'yaml';
import { canonicalJson, sha256Hex } from './canonical.js';

/**
 * Declarations are statements the company makes about itself. Everything in
 * here is USER_ASSERTED: the engine records it, checks it against evidence, and
 * never treats it as proof.
 */

export const DISTRIBUTION_MODELS = ['saas', 'distributed', 'on_prem', 'mobile', 'library', 'internal', 'mixed'] as const;
export type DistributionModel = (typeof DISTRIBUTION_MODELS)[number];

export const ORIGINS = ['human', 'ai_assisted', 'ai_generated', 'third_party', 'generated'] as const;
export type DeclaredOrigin = (typeof ORIGINS)[number];

export const AGREEMENTS = ['employee_piia', 'contractor_assignment', 'cla', 'founder_assignment', 'none', 'unknown'] as const;
export type AgreementType = (typeof AGREEMENTS)[number];

export interface AiToolDeclaration {
  tool: string;
  plan?: string;
  indemnity?: boolean;
  duplicateFilter?: boolean;
  from?: string;
  to?: string;
  evidence?: string;
}

export interface OriginDeclaration {
  paths: string[];
  origin: DeclaredOrigin;
  statement?: string;
  declaredOn?: string;
  by?: string;
}

export interface ContributorAgreement {
  email?: string;
  name?: string;
  agreement: AgreementType;
  signedOn?: string;
  entity?: string;
}

export interface Suppression {
  rule: string;
  fingerprint: string;
  reason: string;
  by?: string;
}

export interface Declarations {
  company: { names: string[]; domains: string[] };
  distribution: DistributionModel | null;
  /** The company's own statement on whether AI coding tools were used at all. */
  aiUsage: 'none' | 'some' | null;
  aiTools: AiToolDeclaration[];
  origins: OriginDeclaration[];
  contributors: ContributorAgreement[] | null;
  suppressions: Suppression[];
  /** Where the declarations came from (repository path or "supplied"). */
  source: string;
  digest: string;
}

export class DeclarationError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, field: string, required = false): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw new DeclarationError(`${field} is required`);
    return undefined;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== 'string' && typeof v !== 'number') throw new DeclarationError(`${field} must be a string`);
  const s = String(v).trim();
  if (s.length > 500) throw new DeclarationError(`${field} is too long`);
  return s;
}

function date(v: unknown, field: string): string | undefined {
  const s = str(v, field);
  if (s === undefined) return undefined;
  if (!DATE.test(s)) throw new DeclarationError(`${field} must be YYYY-MM-DD`);
  return s;
}

function bool(v: unknown, field: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new DeclarationError(`${field} must be true or false`);
  return v;
}

function list(v: unknown, field: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DeclarationError(`${field} must be a list`);
  if (v.length > 10_000) throw new DeclarationError(`${field} has too many entries`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  const s = str(v, field, true)!;
  if (!(allowed as readonly string[]).includes(s)) throw new DeclarationError(`${field} must be one of ${allowed.join(', ')}`);
  return s as T;
}

export function parseDeclarations(text: string, source: string): Declarations {
  if (text.length > 2 * 1024 * 1024) throw new DeclarationError('declarations file is too large');
  let doc: unknown;
  try {
    doc = YAML.parse(text, { maxAliasCount: 50, prettyErrors: false });
  } catch (err) {
    throw new DeclarationError(`declarations are not valid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  if (doc === null || doc === undefined) doc = {};
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new DeclarationError('declarations must be a mapping');
  const d = doc as Record<string, unknown>;
  const company = (d.company ?? {}) as Record<string, unknown>;
  const distribution = d.distribution === undefined || d.distribution === null ? null : oneOf(d.distribution, DISTRIBUTION_MODELS, 'distribution');

  const aiTools = list(d.ai_tools, 'ai_tools').map((raw, i) => {
    const t = raw as Record<string, unknown>;
    const out: AiToolDeclaration = { tool: str(t.tool, `ai_tools[${i}].tool`, true)!.toLowerCase() };
    const plan = str(t.plan, `ai_tools[${i}].plan`);
    if (plan) out.plan = plan.toLowerCase();
    const ind = bool(t.indemnity, `ai_tools[${i}].indemnity`);
    if (ind !== undefined) out.indemnity = ind;
    const df = bool(t.duplicate_filter, `ai_tools[${i}].duplicate_filter`);
    if (df !== undefined) out.duplicateFilter = df;
    const from = date(t.from, `ai_tools[${i}].from`);
    if (from) out.from = from;
    const to = date(t.to, `ai_tools[${i}].to`);
    if (to) out.to = to;
    const ev = str(t.evidence, `ai_tools[${i}].evidence`);
    if (ev) out.evidence = ev;
    return out;
  });

  const origins = list(d.origins, 'origins').map((raw, i) => {
    const o = raw as Record<string, unknown>;
    const paths = list(o.paths, `origins[${i}].paths`).map((p, j) => str(p, `origins[${i}].paths[${j}]`, true)!);
    if (!paths.length) throw new DeclarationError(`origins[${i}].paths must not be empty`);
    const out: OriginDeclaration = { paths, origin: oneOf(o.origin, ORIGINS, `origins[${i}].origin`) };
    const st = str(o.statement, `origins[${i}].statement`);
    if (st) out.statement = st;
    const on = date(o.declared_on, `origins[${i}].declared_on`);
    if (on) out.declaredOn = on;
    const by = str(o.by, `origins[${i}].by`);
    if (by) out.by = by;
    return out;
  });

  const contributors =
    d.contributors === undefined
      ? null
      : list(d.contributors, 'contributors').map((raw, i) => parseAgreement(raw as Record<string, unknown>, `contributors[${i}]`));

  const suppressions = list(d.suppressions, 'suppressions').map((raw, i) => {
    const s = raw as Record<string, unknown>;
    const reason = str(s.reason, `suppressions[${i}].reason`, true)!;
    if (reason.length < 10) throw new DeclarationError(`suppressions[${i}].reason must explain the decision`);
    const out: Suppression = {
      rule: str(s.rule, `suppressions[${i}].rule`, true)!,
      fingerprint: str(s.fingerprint, `suppressions[${i}].fingerprint`, true)!,
      reason,
    };
    const by = str(s.by, `suppressions[${i}].by`);
    if (by) out.by = by;
    return out;
  });

  const aiUsage = d.ai_usage === undefined || d.ai_usage === null ? null : oneOf(d.ai_usage, ['none', 'some'] as const, 'ai_usage');

  const decl: Omit<Declarations, 'digest'> = {
    aiUsage,
    company: {
      names: list(company.names, 'company.names').map((n, i) => str(n, `company.names[${i}]`, true)!),
      domains: list(company.domains, 'company.domains').map((n, i) => str(n, `company.domains[${i}]`, true)!.toLowerCase()),
    },
    distribution,
    aiTools,
    origins,
    contributors,
    suppressions,
    source,
  };
  return { ...decl, digest: sha256Hex(canonicalJson({ ...decl, source: undefined })) };
}

function parseAgreement(c: Record<string, unknown>, field: string): ContributorAgreement {
  const email = str(c.email, `${field}.email`)?.toLowerCase();
  const name = str(c.name, `${field}.name`);
  if (!email && !name) throw new DeclarationError(`${field} needs an email or a name`);
  const out: ContributorAgreement = { agreement: oneOf(c.agreement ?? 'unknown', AGREEMENTS, `${field}.agreement`) };
  if (email) out.email = email;
  if (name) out.name = name;
  const on = date(c.signed_on, `${field}.signed_on`);
  if (on) out.signedOn = on;
  const entity = str(c.entity, `${field}.entity`);
  if (entity) out.entity = entity;
  return out;
}

/** Parse an IP register CSV: header row with email,name,agreement,signed_on,entity (any order). */
export function parseRegisterCsv(text: string): ContributorAgreement[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col('email') < 0 && col('name') < 0) throw new DeclarationError('register needs an email or name column');
  const out: ContributorAgreement[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.every((c) => !c.trim())) continue;
    const get = (name: string) => (col(name) >= 0 ? r[col(name)]?.trim() || undefined : undefined);
    out.push(
      parseAgreement(
        { email: get('email'), name: get('name'), agreement: get('agreement') ?? 'unknown', signed_on: get('signed_on'), entity: get('entity') },
        `register row ${i + 1}`,
      ),
    );
  }
  return out;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function emptyDeclarations(): Declarations {
  return parseDeclarations('{}', 'none');
}
