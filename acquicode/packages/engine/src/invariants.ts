import type { Dossier } from './model.js';
import { SECRET_RULES } from './analyzers/secrets.js';

/**
 * Rules a dossier must satisfy before it is emitted. They encode the product's
 * central promise: uncertainty is never presented as certainty. `analyze()`
 * throws if any is violated, so a bad dossier fails closed instead of shipping.
 */
export function checkInvariants(d: Dossier): string[] {
  const v: string[] = [];
  const evidenceIds = new Set(d.evidence.map((e) => e.id));
  const byId = new Map(d.evidence.map((e) => [e.id, e]));

  for (const f of d.findings) {
    if (f.materiality === 'blocking' && f.state !== 'OBSERVED' && f.state !== 'VERIFIED') v.push(`I1 blocking finding ${f.id} rests on ${f.state} evidence`);
    for (const e of f.evidence) if (!evidenceIds.has(e)) v.push(`I2 finding ${f.id} cites missing evidence ${e}`);
  }

  for (const q of d.questions) {
    if (q.status === 'SATISFIED' && ['CONFLICTING', 'UNKNOWN', 'UNVERIFIABLE', 'STALE'].includes(q.state)) v.push(`I3 question ${q.id} is satisfied on ${q.state} evidence`);
  }

  const active = d.findings.filter((f) => !f.suppressed);
  const hasBlocking = active.some((f) => f.materiality === 'blocking');
  if (d.readiness.level === 'BLOCKED' && !hasBlocking) v.push('I5 readiness BLOCKED without a blocking finding');
  if (hasBlocking && d.readiness.level !== 'BLOCKED') v.push('I5 blocking finding present but readiness is not BLOCKED');
  if (d.readiness.level === 'READY') {
    if (d.unknowns.some((u) => u.material)) v.push('I4 READY with material unknowns');
    if (d.questions.some((q) => q.status !== 'SATISFIED' && q.status !== 'NOT_APPLICABLE')) v.push('I4 READY with unanswered questions');
  }

  let sum = 0;
  for (const f of d.files) {
    const ai = f.ai;
    if (!ai) continue;
    sum++;
    if (ai.category === 'none' && ai.state !== 'UNKNOWN') v.push(`I6 ${f.path}: no evidence but state ${ai.state}`);
    if (ai.category === 'inference' && ai.state !== 'INFERRED') v.push(`I6 ${f.path}: inference-only but state ${ai.state}`);
    if ((ai.category === 'direct_line' || ai.category === 'direct_commit') && (ai.state === 'INFERRED' || ai.state === 'UNKNOWN')) v.push(`I6 ${f.path}: direct evidence with state ${ai.state}`);
    for (const e of ai.evidence) if (!evidenceIds.has(e)) v.push(`I2 file ${f.path} cites missing evidence ${e}`);
    // I11: a file counted as directly attributed must cite at least one DIRECT evidence item.
    if ((ai.category === 'direct_line' || ai.category === 'direct_commit') && !ai.evidence.some((e) => byId.get(e)?.evidenceClass === 'DIRECT')) {
      v.push(`I11 ${f.path}: ${ai.category} without a DIRECT evidence item`);
    }
  }
  const a = d.aiDevelopment;
  const cats = a.files.direct_line + a.files.direct_commit + a.files.corroborating + a.files.inference + a.files.none;
  if (cats !== a.filesConsidered || sum !== a.filesConsidered) v.push(`I7 AI file counts (${cats}, ${sum}) do not match files considered (${a.filesConsidered})`);
  const hasLineRecords = d.evidence.some((e) => (e.kind === 'provenance.git_ai_note' || e.kind === 'provenance.agent_trace') && e.state !== 'UNVERIFIABLE');
  if (a.lines.aiAttributed !== null && !hasLineRecords) v.push('I9 line-level AI counts reported without line-level records');

  for (const e of d.evidence) {
    if (e.evidenceClass === 'INFERENCE' && e.state !== 'INFERRED') v.push(`I10 inference evidence ${e.id} has state ${e.state}`);
    // I12: editor-inserted signals can corroborate, never attribute.
    if (e.attributes?.reliability === 'editor_inserted' && e.evidenceClass === 'DIRECT') v.push(`I12 editor-inserted signal ${e.id} classed as DIRECT`);
  }

  // I8: no provider-format secret value may appear anywhere in the text the dossier carries.
  const texts: string[] = [];
  for (const e of d.evidence) if (e.extract) texts.push(e.extract);
  for (const f of d.findings) texts.push(f.summary);
  texts.push(...d.summary.paragraphs);
  for (const c of d.commits) texts.push(c.subject, ...c.trailers.map(([k, val]) => `${k}: ${val}`));
  const provider = SECRET_RULES.filter((r) => r.confidence === 'provider' && r.id !== 'private-key');
  for (const t of texts) {
    for (const r of provider) {
      r.re.lastIndex = 0;
      if (r.re.test(t)) v.push(`I8 dossier text contains a ${r.id} value`);
    }
  }
  return v;
}

export class InvariantViolation extends Error {
  constructor(readonly violations: string[]) {
    super(`dossier violates ${violations.length} invariant(s): ${violations.slice(0, 5).join('; ')}`);
  }
}
