import { stableId, sortBy } from '../canonical.js';
import type {
  AiEvidenceSummary,
  Area,
  Contributor,
  Coverage,
  Dependency,
  DiligenceAnswer,
  Finding,
  FollowUp,
  LicenseSummary,
  ProvenanceState,
  QuestionStatus,
  Readiness,
  UnknownItem,
} from '../model.js';
import { combineAny, isSupported } from '../states.js';
import type { RuleId } from '../rules.js';
import { FOLLOW_UPS, audienceForArea } from './followups.js';
import type { Declarations } from '../declarations.js';

export interface QuestionInput {
  findings: Finding[];
  unknowns: UnknownItem[];
  ai: AiEvidenceSummary;
  licenses: LicenseSummary;
  dependencies: Dependency[];
  contributors: Contributor[];
  registerSupplied: boolean;
  hasHistory: boolean;
  coverage: Coverage;
  declarations: Declarations | null;
  aiProviders: string[];
}

interface QuestionDef {
  id: string;
  area: Area;
  question: string;
  rules: RuleId[];
  evaluate: (ctx: QuestionInput, own: Finding[], unknowns: UnknownItem[]) => { status: QuestionStatus; rationale: string; state?: ProvenanceState };
}

const has = (fs: Finding[], ...rules: RuleId[]) => fs.filter((f) => rules.includes(f.rule as RuleId));
const material = (fs: Finding[]) => fs.filter((f) => f.materiality === 'blocking' || f.materiality === 'material');
const blocking = (fs: Finding[]) => fs.filter((f) => f.materiality === 'blocking');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const QUESTIONS: QuestionDef[] = [
  {
    id: 'Q-OWN-1',
    area: 'ownership',
    question: 'Can the company show who wrote the code and that it holds the rights to it?',
    rules: ['OWN-001', 'OWN-002', 'OWN-003', 'OWN-009'],
    evaluate: (c, own) => {
      const humans = c.contributors.filter((k) => k.class !== 'bot' && k.class !== 'ai_agent');
      if (!c.hasHistory) return { status: 'UNKNOWN', rationale: 'No git history was available, so contributors cannot be identified.' };
      if (material(own).length) return { status: 'ATTENTION', rationale: `${plural(humans.length, 'person', 'people')} committed code. ${own.map((f) => f.title).join('; ')}.` };
      if (!c.registerSupplied) return { status: 'UNKNOWN', rationale: `${plural(humans.length, 'person', 'people')} committed code, all under company addresses, but no IP register was supplied, so agreement coverage is unknown.` };
      return { status: 'SATISFIED', rationale: `Every one of the ${humans.length} human contributors matches an agreement in the supplied register (company-asserted).`, state: 'USER_ASSERTED' };
    },
  },
  {
    id: 'Q-OWN-2',
    area: 'ownership',
    question: 'Does the first-party code contain code owned or licensed by someone else?',
    rules: ['OWN-004', 'OWN-005', 'OWN-006', 'OWN-007', 'OWN-010', 'OWN-011'],
    evaluate: (_c, own) => {
      if (material(own).length) return { status: 'ATTENTION', rationale: own.map((f) => f.summary.split('. ')[0]).join(' ') + '.' };
      if (own.length) return { status: 'ATTENTION', rationale: own.map((f) => f.title).join('; ') + '.' };
      return { status: 'SATISFIED', rationale: 'No third-party copyright notices, Stack Overflow references, copied-code comments, foreign SPDX headers or unlicensed vendored code were found in first-party files. Snippet matching against open-source code was not performed.', state: 'DERIVED' };
    },
  },
  {
    id: 'Q-PROV-1',
    area: 'provenance',
    question: 'Can the origin of the code be established from the repository?',
    rules: ['OWN-008', 'REP-008', 'AI-012'],
    evaluate: (c, own, unknowns) => {
      if (!c.hasHistory) return { status: 'UNKNOWN', rationale: 'No git history: origin cannot be traced.' };
      if (material(own).length) return { status: 'ATTENTION', rationale: own.map((f) => f.title).join('; ') + '.' };
      if (unknowns.some((u) => u.material)) return { status: 'UNKNOWN', rationale: unknowns.filter((u) => u.material).map((u) => u.statement).join('; ') + '.' };
      return { status: 'SATISFIED', rationale: 'History starts without a bulk import, and no opaque binaries or model artifacts are committed.', state: 'DERIVED' };
    },
  },
  {
    id: 'Q-AI-1',
    area: 'ai_development',
    question: 'What evidence exists of AI involvement in the code, and is it consistent?',
    rules: ['AI-001', 'AI-002', 'AI-003', 'AI-004', 'AI-006', 'AI-009', 'AI-011'],
    evaluate: (c, own) => {
      const a = c.ai;
      const conflicts = has(own, 'AI-002', 'AI-003');
      if (!c.hasHistory) return { status: 'UNKNOWN', rationale: 'No git history: AI development evidence cannot be assessed.' };
      const evidenceLine = `${a.files.direct_line} file(s) with line-level attribution, ${a.files.direct_commit} changed in AI-attributed commits, ${a.files.corroborating} with self-declared comments only, ${a.files.inference} flagged by inference only, ${a.files.none} with no evidence either way (of ${a.filesConsidered}).`;
      if (conflicts.length) return { status: 'ATTENTION', rationale: `Evidence and declarations conflict. ${evidenceLine}`, state: 'CONFLICTING' };
      if (has(own, 'AI-009', 'AI-011').length) return { status: 'ATTENTION', rationale: `${has(own, 'AI-009', 'AI-011').map((f) => f.title).join('; ')}. ${evidenceLine}` };
      const anySignal = a.commits.withDirectEvidence > 0 || a.repoSignals.agentConfigFiles.length > 0 || a.files.corroborating > 0;
      if (!anySignal) {
        if (c.declarations?.aiUsage === 'none') return { status: 'SATISFIED', rationale: 'The company declares no AI coding tools were used, and no evidence in the repository contradicts that. Absence of evidence is not proof; the declaration is company-asserted.', state: 'USER_ASSERTED' };
        return { status: 'UNKNOWN', rationale: 'No AI attribution, tool configuration or declaration was found. Whether AI tools were used cannot be determined from the repository; absence of evidence is not evidence of absence.' };
      }
      if (a.lines.aiAttributed === null) return { status: 'UNKNOWN', rationale: `AI tool use is evidenced at commit or repository level, but no line-level records exist, so which code AI produced is not established. ${evidenceLine}` };
      return { status: 'SATISFIED', rationale: `AI involvement is recorded at line level and the sources are consistent. ${evidenceLine}`, state: 'OBSERVED' };
    },
  },
  {
    id: 'Q-AI-2',
    area: 'ai_development',
    question: 'Were AI-attributed changes reviewed by a person other than the author?',
    rules: ['AI-005'],
    evaluate: (c, own) => {
      const a = c.ai;
      if (a.commits.withDirectEvidence === 0) return { status: 'NOT_APPLICABLE', rationale: 'No AI-attributed commits were found.' };
      if (material(own).length) return { status: 'ATTENTION', rationale: own.map((f) => f.summary).join(' ') };
      if (a.reviews.source === 'none') return { status: 'UNKNOWN', rationale: `${a.commits.directEvidenceViaPullRequest} of ${a.commits.withDirectEvidence} AI-attributed commits arrived through pull requests or merges; approvals were not checked because no forge API was connected.` };
      return { status: 'SATISFIED', rationale: `${a.reviews.approvedByOther} AI-attributed commits arrived through pull requests approved by someone other than the author.`, state: 'OBSERVED' };
    },
  },
  {
    id: 'Q-AI-3',
    area: 'ai_development',
    question: 'Were the AI tools used under terms that protect the company?',
    rules: ['AI-008'],
    evaluate: (c, own) => {
      const used = c.ai.tools.filter((t) => t.tool !== 'agents-md' && t.tool !== 'mcp-client');
      if (!used.length) return { status: 'NOT_APPLICABLE', rationale: 'No AI coding tools were evidenced.' };
      if (own.length) return { status: 'ATTENTION', rationale: own.map((f) => f.summary).join(' ') };
      return { status: 'SATISFIED', rationale: `Terms were declared for every evidenced tool (${used.map((t) => `${t.tool}: ${t.declared?.plan ?? 'plan n/a'}${t.declared?.indemnity ? ', indemnified' : ''}`).join('; ')}). These are company assertions.`, state: 'USER_ASSERTED' };
    },
  },
  {
    id: 'Q-LIC-1',
    area: 'licenses',
    question: 'Is the license of the company\'s own code clear?',
    rules: ['LIC-002', 'LIC-003', 'LIC-014'],
    evaluate: (c, own) => {
      const p = c.licenses.project;
      if (material(own).length) return { status: 'ATTENTION', rationale: own.map((f) => f.summary).join(' '), state: p.state };
      if (!p.expression) return { status: 'UNKNOWN', rationale: 'No license file or manifest license was found. For proprietary code this is common; management should confirm the code is proprietary.' };
      return { status: 'SATISFIED', rationale: `The project license is ${p.expression} (${p.certainty.toLowerCase()}, from ${p.source.replace('_', ' ')}).`, state: p.state };
    },
  },
  {
    id: 'Q-LIC-2',
    area: 'licenses',
    question: 'Are the licenses of production dependencies known?',
    rules: ['LIC-013'],
    evaluate: (c, own) => {
      const prod = c.dependencies.filter((d) => d.scope !== 'development' && !d.private);
      if (!prod.length) return { status: c.dependencies.length ? 'SATISFIED' : 'NOT_APPLICABLE', rationale: c.dependencies.length ? 'All dependencies are development-only or private.' : 'No dependencies were found.' };
      const unknown = prod.filter((d) => !d.license || d.license.certainty === 'UNKNOWN').length;
      const likely = prod.filter((d) => d.license?.certainty === 'LIKELY').length;
      if (own.length) return { status: 'ATTENTION', rationale: `${unknown} of ${prod.length} production dependencies have no license information; ${likely} are likely (inferred).` };
      return { status: 'SATISFIED', rationale: `License information exists for all ${prod.length} production dependencies (${likely} inferred rather than exact).`, state: likely ? 'INFERRED' : 'OBSERVED' };
    },
  },
  {
    id: 'Q-LIC-3',
    area: 'licenses',
    question: 'Do production dependencies carry copyleft or use-restricting licenses?',
    rules: ['LIC-010', 'LIC-011', 'LIC-012'],
    evaluate: (c, own) => {
      if (blocking(own).length) return { status: 'BLOCKING', rationale: blocking(own).map((f) => f.summary).join(' ') };
      if (own.length) return { status: 'ATTENTION', rationale: own.map((f) => f.title).join('; ') + '.' };
      const prod = c.dependencies.filter((d) => d.scope !== 'development' && !d.private);
      const unknown = prod.filter((d) => !d.license || d.license.certainty === 'UNKNOWN').length;
      if (prod.length && unknown / prod.length > 0.25) return { status: 'UNKNOWN', rationale: `None found among known licenses, but ${unknown} of ${prod.length} production dependencies have unknown licenses.` };
      return { status: 'SATISFIED', rationale: prod.length ? 'No copyleft or source-available licenses were found among production dependencies with known licenses.' : 'No production dependencies.', state: 'DERIVED' };
    },
  },
  {
    id: 'Q-SEC-1',
    area: 'security',
    question: 'Are credentials exposed in the code or its history?',
    rules: ['SEC-001', 'SEC-002', 'SEC-003'],
    evaluate: (c, own) => {
      if (blocking(own).length) return { status: 'BLOCKING', rationale: `${plural(blocking(own).length, 'credential')} in a provider format ${blocking(own).length === 1 ? 'is' : 'are'} present in the current code.` };
      if (material(own).length) return { status: 'ATTENTION', rationale: own.map((f) => f.title).filter((v, i, a) => a.indexOf(v) === i).join('; ') + '.' };
      if (!c.coverage.secretsHistoryScan.performed) return { status: 'UNKNOWN', rationale: own.length ? 'Only test/example values were found in the current code; history was not scanned.' : 'No credentials in the current code; history was not scanned.' };
      return { status: 'SATISFIED', rationale: `No live-looking credentials in the current code or in ${c.coverage.secretsHistoryScan.blobsScanned} historical file versions${own.length ? ' (test/example values only)' : ''}.`, state: 'DERIVED' };
    },
  },
  {
    id: 'Q-SEC-2',
    area: 'security',
    question: 'Are known vulnerabilities in production dependencies understood?',
    rules: ['SEC-010', 'SEC-011'],
    evaluate: (c, own) => {
      if (blocking(own).length) return { status: 'BLOCKING', rationale: blocking(own).map((f) => f.summary).join(' ') };
      if (own.length) return { status: 'ATTENTION', rationale: own.map((f) => f.summary).join(' ') };
      const performed = c.coverage.enrichment.some((e) => e.performed && e.source.includes('osv'));
      if (!c.dependencies.some((d) => d.version && !d.private)) return { status: 'NOT_APPLICABLE', rationale: 'No public dependencies with exact versions were found to check.' };
      if (!performed) return { status: 'UNKNOWN', rationale: 'Advisories were not checked (vulnerability enrichment disabled). This is not a clean result.' };
      return { status: 'SATISFIED', rationale: 'No high or critical advisories affect production dependencies with exact versions. Reachability was not assessed.', state: 'OBSERVED' };
    },
  },
  {
    id: 'Q-SEC-3',
    area: 'security',
    question: 'Are the build pipeline and supply chain protected against tampering?',
    rules: ['SEC-020', 'SEC-021', 'SEC-022', 'SEC-023', 'SEC-024', 'SEC-025', 'SEC-030', 'SEC-031', 'SEC-032', 'SEC-033', 'SEC-034'],
    evaluate: (_c, own) => {
      if (material(own).length) return { status: 'ATTENTION', rationale: material(own).map((f) => f.title).join('; ') + '.' };
      if (own.length) return { status: 'SATISFIED', rationale: `Only minor hardening items: ${own.map((f) => f.title).join('; ')}.`, state: 'DERIVED' };
      return { status: 'SATISFIED', rationale: 'No pipeline or supply-chain weaknesses were detected by the rules applied.', state: 'DERIVED' };
    },
  },
  {
    id: 'Q-REP-1',
    area: 'reproducibility',
    question: 'Are the inputs needed to rebuild the software fully declared?',
    rules: ['REP-001', 'REP-002', 'REP-003', 'REP-004', 'REP-005', 'REP-006', 'REP-007', 'REP-008'],
    evaluate: (_c, own) => {
      if (material(own).length) return { status: 'ATTENTION', rationale: material(own).map((f) => f.title).join('; ') + '.' };
      return { status: 'SATISFIED', rationale: `Dependencies are locked and a build pipeline is defined${own.length ? `; minor items: ${own.map((f) => f.title).join('; ')}` : ''}. A rebuild was not performed, so whether the declared inputs reproduce the deployed artifacts is not established.`, state: 'DERIVED' };
    },
  },
  {
    id: 'Q-MNT-1',
    area: 'maintainability',
    question: 'Can a new owner maintain the software?',
    rules: ['MNT-001', 'MNT-002', 'MNT-003', 'MNT-004', 'MNT-007'],
    evaluate: (_c, own) => {
      if (material(own).length) return { status: 'ATTENTION', rationale: material(own).map((f) => f.summary).join(' ') };
      return { status: 'SATISFIED', rationale: own.length ? `Minor items: ${own.map((f) => f.title).join('; ')}.` : 'No key-person concentration, missing tests, missing README or stale dependencies were detected.', state: 'DERIVED' };
    },
  },
  {
    id: 'Q-AID-1',
    area: 'ai_dependency',
    question: 'Is the product materially dependent on specific AI providers?',
    rules: ['AID-001', 'AID-002'],
    evaluate: (c, own) => {
      if (material(own).length) return { status: 'ATTENTION', rationale: own.map((f) => f.summary).join(' ') };
      if (c.aiProviders.length) return { status: 'SATISFIED', rationale: `The product calls ${c.aiProviders.join(', ')}, spread across providers or through abstraction layers.`, state: 'OBSERVED' };
      return { status: 'SATISFIED', rationale: 'No AI provider SDKs or API endpoints were found in production code.', state: 'DERIVED' };
    },
  },
  {
    id: 'Q-EVQ-1',
    area: 'evidence_quality',
    question: 'Which important claims rest on weak, stale or conflicting evidence?',
    rules: ['EVQ-002', 'AI-004', 'OWN-009', 'EVQ-003'],
    evaluate: (c, own) => {
      const weak = c.findings.filter((f) => !f.suppressed && (f.materiality === 'material' || f.materiality === 'blocking') && (!isSupported(f.state) || f.state === 'INFERRED' || f.state === 'USER_ASSERTED'));
      const materialUnknowns = c.unknowns.filter((u) => u.material).length;
      if (material(own).length || weak.some((f) => f.state === 'CONFLICTING' || f.state === 'STALE')) {
        return { status: 'ATTENTION', rationale: `${plural(weak.length, 'finding')} rest on inferred, company-asserted, stale or conflicting evidence; ${plural(materialUnknowns, 'material unknown')} remain.` };
      }
      if (materialUnknowns) return { status: 'UNKNOWN', rationale: `${plural(materialUnknowns, 'material unknown')} remain (see Material Unknowns). ${plural(weak.length, 'finding')} rest on inferred or company-asserted evidence.` };
      return { status: 'SATISFIED', rationale: 'Material findings rest on observed evidence and no material unknowns remain.', state: 'DERIVED' };
    },
  },
];

export function evaluateQuestions(input: QuestionInput): DiligenceAnswer[] {
  const active = input.findings.filter((f) => !f.suppressed);
  return QUESTIONS.map((q) => {
    const own = sortBy(
      active.filter((f) => (q.rules as string[]).includes(f.rule)),
      (f) => ['blocking', 'material', 'minor', 'info'].indexOf(f.materiality),
      (f) => f.rule,
      (f) => f.id,
    );
    const unknowns = input.unknowns.filter((u) => u.area === q.area || (q.area === 'provenance' && u.area === 'provenance'));
    const r = q.evaluate(input, own, unknowns);
    const followUps: FollowUp[] = [];
    const seen = new Set<string>();
    for (const f of own) {
      for (const [audience, text] of FOLLOW_UPS[f.rule as RuleId] ?? []) {
        const key = `${audience}:${text}`;
        const existing = followUps.find((x) => `${x.audience}:${x.text}` === key);
        if (existing) {
          existing.basis.push(f.id);
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        followUps.push({ audience, text, basis: [f.id] });
      }
    }
    for (const u of unknowns.filter((x) => x.material)) {
      followUps.push({ audience: audienceForArea(u.area), text: `${u.statement} is unknown. ${u.resolveBy}`, basis: [u.id] });
    }
    // The answer is as well supported as the strongest finding that drives its status.
    const drivers = r.status === 'BLOCKING' ? own.filter((f) => f.materiality === 'blocking') : r.status === 'ATTENTION' ? (own.filter((f) => f.materiality === 'blocking' || f.materiality === 'material').length ? own.filter((f) => f.materiality === 'blocking' || f.materiality === 'material') : own) : [];
    const state: ProvenanceState = r.state ?? (drivers.length ? combineAny(drivers.map((f) => f.state)) : r.status === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED');
    return {
      id: q.id,
      area: q.area,
      question: q.question,
      status: r.status,
      state,
      rationale: r.rationale,
      findings: own.map((f) => f.id),
      unknowns: unknowns.map((u) => u.id),
      followUps,
    };
  });
}

/**
 * READY only if every question is satisfied or not applicable and no material
 * unknown remains. BLOCKED only from blocking findings whose evidence is
 * OBSERVED or VERIFIED (enforced when findings are finalised).
 */
export function computeReadiness(questions: DiligenceAnswer[], findings: Finding[], unknowns: UnknownItem[]): { level: Readiness; reasons: string[] } {
  const active = findings.filter((f) => !f.suppressed);
  const blockingFindings = active.filter((f) => f.materiality === 'blocking');
  if (blockingFindings.length) {
    const counts = new Map<string, number>();
    for (const f of sortBy(blockingFindings, (x) => x.rule, (x) => x.id)) {
      const label = `${f.title}${f.repository ? ` (${f.repository})` : ''}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return { level: 'BLOCKED', reasons: [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} (${n})` : label)) };
  }
  const attention = questions.filter((q) => q.status === 'ATTENTION' || q.status === 'BLOCKING');
  const unknownQs = questions.filter((q) => q.status === 'UNKNOWN');
  const materialUnknowns = unknowns.filter((u) => u.material);
  if (attention.length || unknownQs.length || materialUnknowns.length) {
    const reasons = [
      ...attention.map((q) => `Needs attention: ${q.question}`),
      ...unknownQs.map((q) => `Unknown: ${q.question}`),
    ];
    if (!reasons.length) reasons.push(`${materialUnknowns.length} material unknown(s) remain`);
    return { level: 'REVIEW', reasons };
  }
  return { level: 'READY', reasons: ['Every diligence question is satisfied or not applicable and no material unknowns remain.'] };
}

export function unknownId(area: Area, statement: string): string {
  return stableId('uk', area, statement);
}
