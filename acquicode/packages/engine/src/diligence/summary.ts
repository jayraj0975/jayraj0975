import type { Dossier, ExecutiveSummary, Materiality } from '../model.js';

const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString('en-US')} ${x === 1 ? one : many}`;

/**
 * The executive summary is assembled from templates bound to the evidence
 * model. No language model writes it, so it cannot state more than the data.
 */
export function buildSummary(d: Dossier): ExecutiveSummary {
  const active = d.findings.filter((f) => !f.suppressed);
  const counts: Record<Materiality, number> = { blocking: 0, material: 0, minor: 0, info: 0 };
  for (const f of active) counts[f.materiality]++;
  const materialUnknowns = d.unknowns.filter((u) => u.material).length;
  const suppressed = d.findings.length - active.length;

  const headline =
    d.readiness.level === 'BLOCKED'
      ? `${n(counts.blocking, 'finding')} must be resolved before close; ${n(counts.material, 'further material finding')} and ${n(materialUnknowns, 'material unknown')} remain.`
      : d.readiness.level === 'REVIEW'
        ? `${n(counts.material, 'material finding')} and ${n(materialUnknowns, 'material unknown')} need answers before this software can be relied on.`
        : 'Every diligence question is answered and no material unknowns remain.';

  const paragraphs: string[] = [];
  const subj = d.subjects
    .map((s) => (s.headCommit ? `${s.name} at ${s.headCommit.slice(0, 12)}${s.branch ? ` (${s.branch})` : ''}` : `${s.name} (directory snapshot, no git history)`))
    .join('; ');
  const hist = d.coverage.history;
  paragraphs.push(
    `Scope: ${subj}. ${n(d.coverage.filesTotal, 'file')} inventoried, ${n(d.coverage.filesContentScanned, 'file')} read in full${hist.available ? `, ${n(hist.commitsAnalyzed, 'commit')} of history${hist.shallow ? ' (shallow clone: earlier history missing)' : hist.truncated ? ' (truncated)' : ''}` : ', no history'}. Produced by ${d.analyzer.name} ${d.analyzer.version} with rules ${d.analyzer.rulesVersion}; re-running the same analyzer on the same commits yields the same dossier digest.`,
  );

  const a = d.aiDevelopment;
  if (hist.available) {
    const lineBits: string[] = [];
    if (a.lines.aiAttributed !== null) lineBits.push(`${n(a.lines.aiAttributed, 'surviving line')} carry line-level AI attribution and ${n(a.lines.humanAttributed ?? 0, 'line')} carry line-level human attribution`);
    if (a.lines.fromAiAttributedCommits && a.lines.fromAiAttributedCommits > 0) lineBits.push(`${n(a.lines.fromAiAttributedCommits, 'current line')} originate in commits that carry AI attribution (commit-level: the commit says a tool took part, not which lines it wrote)`);
    const tools = a.tools.filter((t) => t.tool !== 'agents-md' && t.tool !== 'mcp-client').map((t) => t.tool);
    paragraphs.push(
      `AI development evidence: of ${n(a.filesConsidered, 'first-party file')}, ${a.files.direct_line} have line-level AI attribution, ${a.files.direct_commit} were changed in AI-attributed commits, ${a.files.corroborating} carry only self-declared comments, ${a.files.inference} are flagged by inference only, and ${a.files.none} have no evidence either way.${lineBits.length ? ` ${lineBits.join('; ')}.` : ''} ${tools.length ? `Tools evidenced: ${tools.join(', ')}.` : 'No AI coding tool is evidenced.'} These are counts of evidence, not an estimate of how much code AI wrote; files with no evidence are unknown, not human-written.${a.contradictions ? ` ${n(a.contradictions, 'contradiction')} between sources or declarations.` : ''}`,
    );
  } else {
    paragraphs.push('AI development evidence: not assessable. The source has no git history, so commit metadata, attribution notes and review records are unavailable; every file is UNKNOWN.');
  }

  const humans = d.ownership.contributors.filter((c) => c.class !== 'bot' && c.class !== 'ai_agent');
  if (hist.available) {
    const nonOrg = humans.filter((c) => c.class !== 'org_domain' && c.class !== 'org_domain_inferred').length;
    const covered = humans.filter((c) => c.agreement && c.agreement.type !== 'none' && c.agreement.type !== 'unknown').length;
    paragraphs.push(
      `Ownership: ${n(humans.length, 'person', 'people')} committed code; ${nonOrg} used personal, external or no-reply addresses. ${d.ownership.registerSupplied ? `The company-supplied IP register covers ${covered} of them.` : 'No IP register was supplied, so agreement coverage is unknown.'} History: ${d.ownership.historyCoverage}.`,
    );
  }

  const lic = d.licenses;
  const vulnPerformed = d.coverage.enrichment.find((e) => e.performed && /osv/i.test(e.source));
  const vulnFinding = active.find((f) => f.rule === 'SEC-010');
  paragraphs.push(
    `Dependencies and licenses: ${n(d.dependencies.length, 'dependency', 'dependencies')} across ${n(d.components.length, 'component')}; licenses known for ${lic.known}, likely for ${lic.likely}, unknown for ${lic.unknown}. Project license: ${lic.project.expression ?? 'not declared'}. ${vulnPerformed ? (vulnFinding ? vulnFinding.summary : `Advisories checked against ${vulnPerformed.source} on ${vulnPerformed.queriedAt?.slice(0, 10)}: none high or critical in production dependencies.`) : 'Known vulnerabilities were not checked (enrichment disabled); that section is UNKNOWN, not clean.'}`,
  );

  const unknownList = d.unknowns.filter((u) => u.material).slice(0, 4).map((u) => u.statement);
  paragraphs.push(
    `Limits: the analysis did not build or run the software, did not match snippets against public code, and did not see anything outside the repository${d.subjects.length > 1 ? 'ies' : ''}.${unknownList.length ? ` Material unknowns include: ${unknownList.join('; ')}.` : ''}${suppressed ? ` ${n(suppressed, 'finding')} ${suppressed === 1 ? 'was' : 'were'} suppressed by the company (company-asserted reasons are listed in the evidence index).` : ''}`,
  );

  const top = active.filter((f) => f.materiality === 'blocking' || f.materiality === 'material').slice(0, 6).map((f) => f.id);
  return { headline, paragraphs, counts, topFindings: top };
}
