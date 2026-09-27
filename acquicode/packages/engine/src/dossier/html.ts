import type { Audience, DiligenceAnswer, Dossier, EvidenceItem, Finding, ProvenanceState, QuestionStatus } from '../model.js';
import { dossierDigest } from '../analyze.js';
import type { DsseEnvelope, DossierStatement } from './sign.js';
import type { DossierDiff } from './diff.js';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
/** Escape every repository-derived string. Nothing from the repository is ever emitted as markup. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]!);
}

const STATE_LABEL: Record<ProvenanceState, string> = {
  VERIFIED: 'Verified',
  OBSERVED: 'Observed',
  DERIVED: 'Derived',
  USER_ASSERTED: 'Company-asserted',
  INFERRED: 'Inferred',
  UNKNOWN: 'Unknown',
  CONFLICTING: 'Conflicting',
  UNVERIFIABLE: 'Unverifiable',
  STALE: 'Stale',
};

const STATUS_LABEL: Record<QuestionStatus, string> = {
  SATISFIED: 'Satisfied',
  ATTENTION: 'Attention',
  BLOCKING: 'Blocking',
  UNKNOWN: 'Unknown',
  NOT_APPLICABLE: 'Not applicable',
};

function statePill(s: ProvenanceState): string {
  return `<span class="state state-${s.toLowerCase()}" title="Provenance state">${esc(STATE_LABEL[s])}</span>`;
}

function matPill(m: Finding['materiality']): string {
  return `<span class="mat mat-${m}">${esc(m)}</span>`;
}

function statusPill(s: QuestionStatus): string {
  return `<span class="status status-${s.toLowerCase().replace('_', '-')}">${esc(STATUS_LABEL[s])}</span>`;
}

function locator(e: EvidenceItem): string {
  const l = e.locator;
  const parts: string[] = [];
  if (l.repository) parts.push(`${l.repository}:`);
  if (l.path) parts.push(`${l.path}${l.line ? `:${l.line}` : ''}`);
  if (l.commit) parts.push(`${l.path ? ' @ ' : 'commit '}${l.commit.slice(0, 12)}`);
  if (l.source && !l.path) parts.push(l.source);
  else if (l.source) parts.push(` (${l.source})`);
  return esc(parts.join(''));
}

function evLinks(ids: string[], max = 6): string {
  if (!ids.length) return '<span class="muted">—</span>';
  const shown = ids.slice(0, max).map((id) => `<a href="#${esc(id)}" class="evref">${esc(id.slice(3, 11))}</a>`).join(' ');
  return shown + (ids.length > max ? ` <span class="muted">+${ids.length - max}</span>` : '');
}

function table(head: string[], rows: string[][], cls = ''): string {
  if (!rows.length) return '<p class="muted">None.</p>';
  return `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function findingBlock(f: Finding): string {
  return `<article class="finding" id="${esc(f.id)}">
  <header>${matPill(f.materiality)} <span class="rule">${esc(f.rule)}</span> <h4>${esc(f.title)}</h4> ${statePill(f.state)}${f.suppressed ? ' <span class="suppressed">Suppressed by company</span>' : ''}</header>
  <p>${esc(f.summary)}</p>
  ${f.suppressed ? `<p class="muted">Suppression reason (company-asserted): ${esc(f.suppressed.reason)} — ${esc(f.suppressed.by)}</p>` : ''}
  <p class="meta">Evidence: ${evLinks(f.evidence)}${f.repository ? ` · Repository: ${esc(f.repository)}` : ''}${f.component ? ` · Component: ${esc(f.component)}` : ''} · Fingerprint <code>${esc(f.fingerprint)}</code> · Rule v${f.ruleVersion}</p>
</article>`;
}

function findingsFor(d: Dossier, areas: string[]): string {
  const list = d.findings.filter((f) => areas.includes(f.area));
  if (!list.length) return '<p class="muted">No findings from the rules applied.</p>';
  return list.map(findingBlock).join('\n');
}

function questionRow(q: DiligenceAnswer): string[] {
  return [`<a href="#${esc(q.id)}">${esc(q.id)}</a>`, esc(q.question), statusPill(q.status), statePill(q.state), esc(q.rationale)];
}

function followUps(d: Dossier, audience: Audience): string {
  const items: Array<{ q: DiligenceAnswer; text: string; basis: string[] }> = [];
  for (const q of d.questions) for (const f of q.followUps) if (f.audience === audience) items.push({ q, text: f.text, basis: f.basis });
  if (!items.length) return '<p class="muted">No questions for this audience.</p>';
  return `<ol class="followups">${items
    .map((i) => `<li><p>${esc(i.text)}</p><p class="meta">Arising from <a href="#${esc(i.q.id)}">${esc(i.q.id)}</a> · basis ${i.basis.map((b) => `<a href="#${esc(b)}">${esc(b.slice(0, 11))}</a>`).join(' ')}</p></li>`)
    .join('')}</ol>`;
}

export interface RenderOptions {
  envelope?: DsseEnvelope | null;
  diff?: DossierDiff | null;
  /** Label shown in the header, e.g. "Demo data" for sample dossiers. */
  banner?: string;
}

export function renderDossierHtml(d: Dossier, opts: RenderOptions = {}): string {
  const digest = dossierDigest(d);
  let statement: DossierStatement | null = null;
  if (opts.envelope) {
    try {
      statement = JSON.parse(Buffer.from(opts.envelope.payload, 'base64').toString('utf8')) as DossierStatement;
    } catch {
      statement = null;
    }
  }
  const a = d.aiDevelopment;
  const cited = new Set<string>();
  for (const f of d.findings) for (const e of f.evidence) cited.add(e);
  for (const f of d.files) for (const e of f.ai?.evidence ?? []) cited.add(e);
  const evidenceRows = d.evidence.filter((e) => cited.has(e.id)).slice(0, 3000);
  const humans = d.ownership.contributors.filter((c) => c.class !== 'bot');
  const aiFiles = d.files.filter((f) => f.ai && f.ai.category !== 'none').slice(0, 300);
  const nonPermissive = d.dependencies.filter((x) => x.scope !== 'development' && (!x.license || x.license.categories.some((c) => c !== 'permissive' && c !== 'public_domain')));

  const sections: string[] = [];

  sections.push(`<section id="summary"><h2><span class="num">1</span>Executive Summary</h2>
  <div class="readiness readiness-${d.readiness.level.toLowerCase()}"><div class="level">${esc(d.readiness.level)}</div><div><p class="headline">${esc(d.summary.headline)}</p><ul>${d.readiness.reasons.slice(0, 8).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div></div>
  <div class="counts">${(['blocking', 'material', 'minor', 'info'] as const).map((m) => `<div><span class="n">${d.summary.counts[m]}</span><span class="l">${m}</span></div>`).join('')}<div><span class="n">${d.unknowns.filter((u) => u.material).length}</span><span class="l">material unknowns</span></div></div>
  ${d.summary.paragraphs.map((p) => { const i = p.indexOf(': '); return i > 0 && i < 40 ? `<p><strong>${esc(p.slice(0, i))}.</strong> ${esc(p.slice(i + 2))}</p>` : `<p>${esc(p)}</p>`; }).join('\n')}
  <h3>Top material findings</h3>
  ${d.summary.topFindings.length ? `<ol>${d.summary.topFindings.map((id) => d.findings.find((f) => f.id === id)).filter((f): f is Finding => !!f).map((f) => `<li><a href="#${esc(f.id)}">${esc(f.title)}</a> ${matPill(f.materiality)} ${statePill(f.state)}</li>`).join('')}</ol>` : '<p class="muted">None.</p>'}
  <h3>Diligence questions</h3>
  ${table(['ID', 'Question', 'Status', 'Evidence', 'Basis'], d.questions.map(questionRow), 'questions')}
  </section>`);

  if (opts.diff) {
    const df = opts.diff;
    sections.push(`<section id="changes"><h2><span class="num">1a</span>Changes Since the Previous Snapshot</h2>
    <p>From ${esc(df.from.commits.map((c) => c.slice(0, 12)).join(', '))} (${esc(df.from.readiness)}) to ${esc(df.to.commits.map((c) => c.slice(0, 12)).join(', '))} (${esc(df.to.readiness)}). ${df.counts.material} material, ${df.counts.minor} minor, ${df.counts.info} informational change(s).</p>
    ${table(['Severity', 'Change', 'Summary'], df.events.map((e) => [`<span class="mat mat-${e.severity}">${esc(e.severity)}</span>`, esc(e.kind.replace(/_/g, ' ')), esc(e.summary)]))}</section>`);
  }

  sections.push(`<section id="inventory"><h2><span class="num">2</span>Repository Inventory</h2>
  ${table(['Repository', 'Commit', 'Branch', 'Remote', 'Content digest'], d.subjects.map((s) => [esc(s.name), s.headCommit ? `<code>${esc(s.headCommit)}</code>` : '<span class="muted">no git history</span>', esc(s.branch ?? '—'), esc(s.remote ?? '—'), `<code>${esc(s.contentDigest.slice(0, 16))}…</code>`]))}
  <div class="grid2">
  <div><h3>Languages (first-party)</h3>${table(['Language', 'Files', 'Lines'], d.inventory.languages.slice(0, 15).map((l) => [esc(l.language), String(l.files), l.lines.toLocaleString('en-US')]))}</div>
  <div><h3>File classes</h3>${table(['Class', 'Files'], Object.entries(d.inventory.classes).filter(([, v]) => v > 0).map(([k, v]) => [esc(k), String(v)]))}</div>
  </div>
  <h3>Build and dependency definitions</h3>
  <dl class="facts"><dt>Manifests</dt><dd>${esc(d.inventory.manifests.join(', ') || '—')}</dd><dt>Lockfiles</dt><dd>${esc(d.inventory.lockfiles.join(', ') || '—')}</dd><dt>CI systems</dt><dd>${esc(d.inventory.ciSystems.join(', ') || 'none found')}</dd><dt>Container files</dt><dd>${esc(d.inventory.containerFiles.join(', ') || '—')}</dd><dt>Submodules</dt><dd>${esc(d.inventory.submodules.map((s) => `${s.path} → ${s.url ?? '?'} @ ${s.commit.slice(0, 12)}`).join('; ') || '—')}</dd><dt>Vendored code</dt><dd>${esc(d.inventory.vendoredRoots.join(', ') || '—')}</dd><dt>Generated files</dt><dd>${d.inventory.generatedFiles}</dd><dt>Binaries</dt><dd>${d.inventory.binaries.length ? esc(d.inventory.binaries.slice(0, 12).map((b) => `${b.path} (${b.kind})`).join(', ')) : '—'}</dd><dt>AI tool configuration</dt><dd>${esc(d.inventory.agentConfigFiles.join(', ') || '—')}</dd><dt>Branches / tags</dt><dd>${d.inventory.branches.length} / ${d.inventory.tags.length}</dd></dl>
  </section>`);

  sections.push(`<section id="ownership"><h2><span class="num">3</span>Software Ownership Evidence</h2>
  <p>History analysed: ${esc(d.ownership.historyCoverage)}. ${d.ownership.registerSupplied ? 'An IP register was supplied by the company; agreement data below is company-asserted.' : 'No IP register was supplied; agreement status is unknown for every contributor.'}</p>
  ${table(
    ['Contributor', 'Identities', 'Class', 'Commits', 'First – last', 'Agreement'],
    humans.slice(0, 200).map((c) => [
      esc(c.displayName) + (c.mergeState === 'INFERRED' ? ' <span class="muted" title="Identities merged by matching name">(merged by name)</span>' : ''),
      esc(c.identities.map((i) => i.email || i.name).join(', ')),
      `${esc(c.class.replace(/_/g, ' '))} ${statePill(c.classState)}`,
      String(c.commits),
      esc(`${c.firstCommitAt.slice(0, 10)} – ${c.lastCommitAt.slice(0, 10)}`),
      c.agreement ? `${esc(c.agreement.type.replace(/_/g, ' '))}${c.agreement.signedOn ? ` (${esc(c.agreement.signedOn)})` : ''} ${statePill(c.agreement.state)}` : '<span class="state state-unknown">Unknown</span>',
    ]),
  )}
  ${humans.length > 200 ? `<p class="muted">${humans.length - 200} more contributors in the JSON export.</p>` : ''}
  ${findingsFor(d, ['ownership'])}
  </section>`);

  const ladder: Array<[string, number, string, string]> = [
    ['Direct, line-level', a.files.direct_line, 'Machine-readable attribution (git-ai notes, Agent Trace) ties specific current lines to an AI tool.', 'direct'],
    ['Direct, commit-level', a.files.direct_commit, 'The file was changed in commits whose metadata names an AI tool (trailer, agent author). Says a tool took part, not which lines it wrote.', 'direct'],
    ['Corroborating only', a.files.corroborating, 'A comment in the file says it was AI-generated. Self-declared; no link to specific commits.', 'corroborating'],
    ['Inference only', a.files.inference, 'Heuristic signal (e.g. a large unattributed change after AI tools were adopted). Not evidence; a reason to ask.', 'inference'],
    ['No evidence either way', a.files.none, 'Nothing in the repository speaks to how this code was produced. Unknown, not human.', 'none'],
  ];
  sections.push(`<section id="ai"><h2><span class="num">4</span>AI Development Evidence</h2>
  <p class="callout">These are counts of evidence, not an estimate of how much code was written by AI. A file with no evidence is <strong>unknown</strong>, not human-written.</p>
  ${table(['Evidence class', `Files (of ${a.filesConsidered})`, 'What it means'], ladder.map(([l, n, m, c]) => [`<span class="ladder ladder-${c}">${esc(l)}</span>`, String(n), esc(m)]))}
  <dl class="facts">
    <dt>Surviving lines with line-level AI attribution</dt><dd>${a.lines.aiAttributed === null ? '<span class="muted">not recorded (no line-level records)</span>' : a.lines.aiAttributed.toLocaleString('en-US')}</dd>
    <dt>Surviving lines with line-level human attribution</dt><dd>${a.lines.humanAttributed === null ? '<span class="muted">not recorded</span>' : a.lines.humanAttributed.toLocaleString('en-US')}</dd>
    <dt>Current lines originating in AI-attributed commits</dt><dd>${a.lines.fromAiAttributedCommits === null ? '<span class="muted">n/a</span>' : a.lines.fromAiAttributedCommits.toLocaleString('en-US')}${a.lines.total !== null ? ` of ${a.lines.total.toLocaleString('en-US')} blamed lines` : ''}${a.lines.blameComplete ? '' : ' <span class="muted">(blame budget reached; partial)</span>'}</dd>
    <dt>Commits with direct AI evidence</dt><dd>${a.commits.withDirectEvidence} of ${a.commits.total} (${a.commits.directEvidenceViaPullRequest} via pull request or merge, ${a.commits.directEvidencePushedDirectly} pushed directly)</dd>
    <dt>Review approvals</dt><dd>${a.reviews.source === 'forge' ? `${a.reviews.approvedByOther} approved by another person, ${a.reviews.notApproved} without such approval, ${a.reviews.unknown} unknown` : '<span class="muted">unknown (forge API not connected)</span>'}</dd>
    <dt>Repository-level signals</dt><dd>${esc(a.repoSignals.agentConfigFiles.join(', ') || 'none')}${a.repoSignals.firstAgentConfigAt ? ` (first added ${esc(a.repoSignals.firstAgentConfigAt.slice(0, 10))})` : ''}</dd>
    <dt>Contradictions / unverifiable records</dt><dd>${a.contradictions} / ${a.unverifiable}</dd>
  </dl>
  <h3>Tools</h3>
  ${table(
    ['Tool', 'Vendor', 'Signals', 'Commits', 'Seen', 'Models', 'Declared terms'],
    a.tools.map((t) => [
      esc(t.tool),
      esc(t.vendor ?? '—'),
      esc(t.signals.join(', ')),
      String(t.commits),
      esc(t.firstSeen ? `${t.firstSeen.slice(0, 10)} – ${(t.lastSeen ?? t.firstSeen).slice(0, 10)}` : '—'),
      esc(t.models.join(', ') || '—'),
      t.declared ? `${esc(Object.entries(t.declared).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${String(v)}`).join('; '))} ${statePill('USER_ASSERTED')}` : '<span class="state state-unknown">Not declared</span>',
    ]),
  )}
  ${findingsFor(d, ['ai_development'])}
  <details><summary>Files with AI evidence (${aiFiles.length}${aiFiles.length === 300 ? '+' : ''})</summary>
  ${table(['File', 'Class', 'AI lines', 'Human lines', 'Lines from AI commits', 'Tools', 'State', 'Evidence'], aiFiles.map((f) => [esc((f.repository ? `${f.repository}/` : '') + f.path), esc(f.ai!.category.replace('_', ' ')), String(f.ai!.aiLines ?? '—'), String(f.ai!.humanLines ?? '—'), String(f.ai!.linesFromAiCommits ?? '—'), esc(f.ai!.tools.join(', ') || '—'), statePill(f.ai!.state), evLinks(f.ai!.evidence, 3)]))}
  </details>
  </section>`);

  const lic = d.licenses;
  sections.push(`<section id="licenses"><h2><span class="num">5</span>Dependency &amp; License Analysis</h2>
  <p>This section reports license facts and their certainty. It does not give legal conclusions; items for counsel are listed in section 11.</p>
  <dl class="facts"><dt>Project license</dt><dd>${esc(lic.project.expression ?? 'not declared')} · ${esc(lic.project.certainty)} ${statePill(lic.project.state)} ${lic.project.files.length ? `(${esc(lic.project.files.join(', '))})` : ''}</dd>
  <dt>Declared distribution model</dt><dd>${d.declarations.distribution ? `${esc(d.declarations.distribution)} ${statePill('USER_ASSERTED')}` : '<span class="muted">not declared (copyleft obligations depend on it)</span>'}</dd>
  <dt>Dependency licenses</dt><dd>Known ${lic.known} · Likely ${lic.likely} · Unknown ${lic.unknown}</dd></dl>
  ${table(['Category', 'Dependencies'], Object.entries(lic.byCategory).filter(([, v]) => v > 0).map(([k, v]) => [esc(k.replace(/_/g, ' ')), String(v)]))}
  <h3>Components</h3>
  ${table(['Component', 'Manifest', 'Lockfile', 'Direct', 'Transitive'], d.components.map((c) => [esc(`${c.ecosystem}:${c.name}`), esc((c.repository && d.subjects.length > 1 ? `${c.repository}/` : '') + c.manifestPath), c.lockfilePath ? esc(c.lockfilePath) : '<span class="state state-unknown">none</span>', String(c.dependencyCount.direct), String(c.dependencyCount.transitive)]))}
  ${findingsFor(d, ['licenses'])}
  <details><summary>Production dependencies that are not permissive or have unknown licenses (${nonPermissive.length})</summary>
  ${table(['Package', 'Version', 'Scope', 'Direct', 'License', 'Certainty', 'Source'], nonPermissive.slice(0, 500).map((x) => [esc(x.name), esc(x.version ?? '—'), esc(x.scope), x.direct ? 'yes' : 'no', esc(x.license?.expression ?? '—'), esc(x.license?.certainty ?? 'UNKNOWN'), esc(x.license?.source ?? 'none')]))}
  </details>
  </section>`);

  sections.push(`<section id="security"><h2><span class="num">6</span>Security Exposure</h2>
  <p>Limited to what could make the software difficult or dangerous to finance, acquire, insure or operate. Secret values are never reproduced; fingerprints identify them.</p>
  ${findingsFor(d, ['security'])}</section>`);

  sections.push(`<section id="reproducibility"><h2><span class="num">7</span>Build &amp; Reproducibility</h2>
  <p>The software was not built. This section establishes whether the inputs needed to rebuild it are declared and pinned.</p>
  ${findingsFor(d, ['reproducibility'])}</section>`);

  const m = d.metrics;
  sections.push(`<section id="maintainability"><h2><span class="num">8</span>Maintainability</h2>
  <dl class="facts"><dt>Source files / lines</dt><dd>${m.sourceFiles ?? '—'} / ${(m.sourceLines ?? 0).toLocaleString('en-US')}</dd><dt>Test files</dt><dd>${m.testFiles ?? '—'}</dd><dt>Human commits in the 12 months before the analysed commit</dt><dd>${m.commitsLast365d ?? '—'}</dd><dt>Bus factor (people covering half of those commits)</dt><dd>${m.busFactor ?? '—'}</dd><dt>Top contributor share</dt><dd>${m.topContributorShare !== null && m.topContributorShare !== undefined ? `${Math.round(m.topContributorShare * 100)}%` : '—'}</dd></dl>
  ${findingsFor(d, ['maintainability'])}
  <h3>Product dependence on AI providers</h3>
  ${findingsFor(d, ['ai_dependency'])}
  <h3>Provenance of code and artifacts</h3>
  ${findingsFor(d, ['provenance'])}
  </section>`);

  sections.push(`<section id="unknowns"><h2><span class="num">9</span>Material Unknowns</h2>
  <p>What this analysis could not establish. Unknowns are never counted as clean.</p>
  ${table(['Area', 'Unknown', 'Why', 'How to resolve', 'Material'], d.unknowns.map((u) => [esc(u.area.replace(/_/g, ' ')), `<span id="${esc(u.id)}">${esc(u.statement)}</span>`, esc(u.why), esc(u.resolveBy), u.material ? 'yes' : 'no']))}
  <h3>Evidence quality</h3>
  ${findingsFor(d, ['evidence_quality'])}
  </section>`);

  sections.push(`<section id="q-management"><h2><span class="num">10</span>Questions for Management</h2>${followUps(d, 'management')}</section>`);
  sections.push(`<section id="q-counsel"><h2><span class="num">11</span>Questions for Counsel</h2><p class="muted">Technical findings and escalation prompts. None of this is legal advice.</p>${followUps(d, 'counsel')}</section>`);
  sections.push(`<section id="q-engineering"><h2><span class="num">12</span>Questions for Engineering</h2>${followUps(d, 'engineering')}</section>`);

  sections.push(`<section id="question-detail"><h2><span class="num">12a</span>Diligence Question Detail</h2>
  ${d.questions.map((q) => `<article class="question" id="${esc(q.id)}"><header><span class="rule">${esc(q.id)}</span> <h4>${esc(q.question)}</h4> ${statusPill(q.status)} ${statePill(q.state)}</header><p>${esc(q.rationale)}</p><p class="meta">Findings: ${q.findings.length ? q.findings.map((f) => `<a href="#${esc(f)}">${esc(f.slice(0, 11))}</a>`).join(' ') : '—'} · Unknowns: ${q.unknowns.length ? q.unknowns.map((u) => `<a href="#${esc(u)}">${esc(u.slice(0, 11))}</a>`).join(' ') : '—'}</p></article>`).join('\n')}
  </section>`);

  sections.push(`<section id="evidence"><h2><span class="num">13</span>Evidence Index</h2>
  <p>Every item cited above. The JSON export contains all ${d.evidence.length.toLocaleString('en-US')} evidence items${evidenceRows.length < cited.size ? `; ${cited.size - evidenceRows.length} cited items are omitted here for length` : ''}. Extracts are short structured values, never source code or secrets.</p>
  ${table(['ID', 'Kind', 'State', 'Class', 'Location', 'Extract', 'Detector'], evidenceRows.map((e) => [`<span id="${esc(e.id)}"><code>${esc(e.id.slice(3, 11))}</code></span>`, esc(e.kind), statePill(e.state), esc(e.evidenceClass ?? '—'), locator(e), esc(e.extract ?? ''), `<code>${esc(e.detector)}</code>`]), 'evidence')}
  </section>`);

  const cov = d.coverage;
  sections.push(`<section id="manifest"><h2><span class="num">14–15</span>Machine-readable Export &amp; Signed Manifest</h2>
  <dl class="facts">
  <dt>Dossier digest (sha256 of canonical JSON)</dt><dd><code>${esc(digest)}</code></dd>
  <dt>Schema / analyzer / rules</dt><dd>${esc(d.schema)} · ${esc(d.analyzer.name)} ${esc(d.analyzer.version)} · rules ${esc(d.analyzer.rulesVersion)}</dd>
  <dt>Options</dt><dd><code>${esc(JSON.stringify(d.options))}</code></dd>
  <dt>Declarations</dt><dd>${d.declarations.supplied ? `${esc(d.declarations.source)} · digest <code>${esc(d.declarations.digest?.slice(0, 16))}…</code> (company-asserted)` : 'none supplied'}</dd>
  <dt>Coverage</dt><dd>${cov.filesContentScanned} of ${cov.filesTotal} files read; skipped ${esc(JSON.stringify(cov.filesSkipped))}; secrets history scan ${cov.secretsHistoryScan.performed ? `${cov.secretsHistoryScan.blobsScanned} historical versions${cov.secretsHistoryScan.truncated ? ' (truncated)' : ''}` : 'not performed'}; notes refs ${esc(cov.history.notesRefs.join(', ') || 'none')}</dd>
  <dt>Enrichment</dt><dd>${cov.enrichment.map((e) => `${esc(e.source)}: ${e.performed ? `queried ${esc(e.queriedAt ?? '')}, ${e.items} items, digest ${esc((e.digest ?? '').slice(0, 12))}` : esc(e.reason ?? 'not performed')}`).join('<br>')}</dd>
  ${statement ? `<dt>Attestation</dt><dd>${esc(statement.predicate.attestation.level)} by ${esc(statement.predicate.attestation.producer)} at ${esc(statement.predicate.attestation.producedAt)} · key ${esc(opts.envelope?.signatures[0]?.keyid ?? '')}<br><span class="muted">${esc(statement.predicate.attestation.note)}</span></dd>` : '<dt>Attestation</dt><dd><span class="muted">Unsigned rendering. Verify with the accompanying .dsse.json envelope.</span></dd>'}
  </dl>
  <h3>How to verify</h3>
  <ol><li>Check the signature: <code>acquicode verify dossier.json --envelope dossier.dsse.json --key signer.pub.pem</code>.</li>
  <li>Reproduce: with access to the same commits, run <code>acquicode verify dossier.json --reproduce &lt;path-to-repo&gt;</code>. The analyzer replays recorded enrichment and must produce the digest above.</li></ol>
  <h3>Provenance states</h3>
  ${table(['State', 'Meaning'], [
    ['VERIFIED', 'Observed and independently checked (e.g. against a cryptographic hash or the forge API).'],
    ['OBSERVED', 'Read directly from the repository or a named external source.'],
    ['DERIVED', 'Computed deterministically from observed facts.'],
    ['USER_ASSERTED', 'Stated by the company; recorded, compared with evidence, never treated as proof.'],
    ['INFERRED', 'A heuristic reading. Raises questions; never blocks.'],
    ['UNKNOWN', 'No evidence either way.'],
    ['CONFLICTING', 'Sources disagree.'],
    ['UNVERIFIABLE', 'A claim exists but cannot be checked against the repository.'],
    ['STALE', 'Evidence that predates later changes to what it describes.'],
  ].map(([s, t]) => [statePill(s as ProvenanceState), esc(t)]))}
  </section>`);

  const title = `Diligence Dossier — ${d.title}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="cover">
  <div class="brand">AcquiCode · Diligence Dossier</div>
  ${opts.banner ? `<div class="banner">${esc(opts.banner)}</div>` : ''}
  <h1>${esc(d.title)}</h1>
  <p class="sub">${d.subjects.map((s) => `${esc(s.name)}${s.headCommit ? ` @ <code>${esc(s.headCommit.slice(0, 12))}</code>` : ''}`).join(' · ')}</p>
  <p class="digest">Dossier digest <code>${esc(digest)}</code></p>
  <nav><a href="#summary">Summary</a><a href="#inventory">Inventory</a><a href="#ownership">Ownership</a><a href="#ai">AI evidence</a><a href="#licenses">Licenses</a><a href="#security">Security</a><a href="#reproducibility">Build</a><a href="#maintainability">Maintainability</a><a href="#unknowns">Unknowns</a><a href="#q-management">Management</a><a href="#q-counsel">Counsel</a><a href="#q-engineering">Engineering</a><a href="#evidence">Evidence</a><a href="#manifest">Manifest</a></nav>
</header>
<main>
${sections.join('\n')}
</main>
<footer><p>Generated by ${esc(d.analyzer.name)} ${esc(d.analyzer.version)}. Deterministic analysis; no language model wrote or edited this document. Not legal advice.</p></footer>
</body>
</html>`;
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#1c1b19;--muted:#6b6862;--line:#e4e0d8;--panel:#ffffff;--accent:#1f3a5f;
--ready:#1f6b3a;--review:#8a5a00;--blocked:#a3242b;--pill:#efece5;--code:#f3f0e9}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e9e6df;--muted:#a09c94;--line:#2c2b29;--panel:#1b1b1a;--accent:#9dbbe0;--ready:#6cc58c;--review:#e0b25c;--blocked:#f0787e;--pill:#2a2927;--code:#232220}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1,h2,h3,h4{font-family:ui-serif,Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.01em}
h1{font-size:2rem;margin:.25rem 0}h2{font-size:1.45rem;border-bottom:1px solid var(--line);padding-bottom:.35rem;margin-top:2.5rem}h3{font-size:1.1rem;margin-top:1.6rem}h4{display:inline;font-size:1rem;margin:0}
.num{display:inline-block;min-width:2.4rem;color:var(--muted);font-family:ui-sans-serif,system-ui,sans-serif;font-size:.9rem;font-weight:500}
.cover{padding:2rem 16px 1rem;max-width:1100px;margin:0 auto;border-bottom:1px solid var(--line)}
.brand{font-size:.8rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
.banner{display:inline-block;margin:.5rem 0;padding:.2rem .6rem;border:1px solid var(--review);color:var(--review);border-radius:4px;font-size:.85rem}
.sub,.digest{color:var(--muted);margin:.2rem 0;overflow-wrap:anywhere}
nav{display:flex;flex-wrap:wrap;gap:.35rem 1rem;margin-top:1rem;font-size:.88rem}nav a{color:var(--accent);text-decoration:none}
main{max-width:1100px;margin:0 auto;padding:0 16px 3rem}
a{color:var(--accent)}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;background:var(--code);padding:.05rem .3rem;border-radius:3px;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;margin:.75rem 0;font-size:.88rem;display:block;overflow-x:auto}
th,td{text-align:left;vertical-align:top;padding:.45rem .6rem;border-bottom:1px solid var(--line)}th{font-weight:600;color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
td{overflow-wrap:anywhere}
.readiness{display:flex;gap:1.25rem;align-items:flex-start;padding:1rem 1.25rem;border:1px solid var(--line);border-left-width:6px;border-radius:6px;background:var(--panel);margin:1rem 0}
.readiness .level{font:700 1.6rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;min-width:7.5rem}
.readiness-ready{border-left-color:var(--ready)}.readiness-ready .level{color:var(--ready)}
.readiness-review{border-left-color:var(--review)}.readiness-review .level{color:var(--review)}
.readiness-blocked{border-left-color:var(--blocked)}.readiness-blocked .level{color:var(--blocked)}
.readiness ul{margin:.4rem 0 0;padding-left:1.1rem;color:var(--muted)}.headline{margin:0;font-weight:600}
.counts{display:flex;flex-wrap:wrap;gap:.75rem;margin:1rem 0}.counts div{border:1px solid var(--line);border-radius:6px;padding:.5rem .9rem;background:var(--panel);min-width:7rem}
.counts .n{display:block;font:600 1.4rem/1.1 ui-sans-serif,system-ui,sans-serif}.counts .l{color:var(--muted);font-size:.8rem}
.state,.mat,.status,.suppressed,.ladder{display:inline-block;font-size:.72rem;font-weight:600;padding:.08rem .45rem;border-radius:999px;background:var(--pill);white-space:nowrap;vertical-align:middle}
.state-verified,.state-observed{color:var(--ready)}.state-derived{color:var(--accent)}.state-user_asserted{color:var(--review)}.state-inferred{color:var(--review);font-style:italic}
.state-unknown,.state-unverifiable,.state-stale{color:var(--muted)}.state-conflicting{color:var(--blocked)}
.mat-blocking{background:var(--blocked);color:#fff}.mat-material{color:var(--blocked)}.mat-minor{color:var(--review)}.mat-info{color:var(--muted)}
.status-satisfied{color:var(--ready)}.status-attention{color:var(--review)}.status-blocking{background:var(--blocked);color:#fff}.status-unknown,.status-not-applicable{color:var(--muted)}
.suppressed{color:var(--muted);border:1px dashed var(--muted);background:transparent}
.ladder-direct{color:var(--ready)}.ladder-corroborating{color:var(--accent)}.ladder-inference{color:var(--review)}.ladder-none{color:var(--muted)}
.finding,.question{border:1px solid var(--line);border-radius:6px;padding:.8rem 1rem;margin:.75rem 0;background:var(--panel)}
.finding header,.question header{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}.finding p,.question p{margin:.45rem 0}
.rule{font:600 .75rem ui-monospace,Menlo,monospace;color:var(--muted)}.meta{font-size:.8rem;color:var(--muted)}.muted{color:var(--muted)}
.evref{font-family:ui-monospace,Menlo,monospace;font-size:.78rem}
.callout{border-left:3px solid var(--accent);padding:.5rem .9rem;background:var(--panel)}
dl.facts{display:grid;grid-template-columns:minmax(10rem,18rem) 1fr;gap:.35rem 1rem;font-size:.9rem}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;overflow-wrap:anywhere}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
details{margin:1rem 0}summary{cursor:pointer;color:var(--accent)}
ol.followups li{margin:.5rem 0}ol.followups p{margin:.1rem 0}
footer{max-width:1100px;margin:0 auto;padding:1rem 16px 3rem;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line)}
@media (max-width:720px){.grid2{grid-template-columns:1fr}dl.facts{grid-template-columns:1fr}.readiness{flex-direction:column}}
@media print{:root{--bg:#fff;--panel:#fff}nav{display:none}section{break-inside:auto}.finding,.question{break-inside:avoid}details{display:block}details::details-content{content-visibility:visible;display:block}details>summary{display:none}a{color:inherit;text-decoration:none}h2{break-after:avoid}}
`;
