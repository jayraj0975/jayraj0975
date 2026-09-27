import Link from 'next/link';
import type { Audience, Dossier, EvidenceItem, Finding } from '@acquicode/engine';
import { Mat, State, Status } from './ui';

export const VIEWS = ['summary', 'questions', 'findings', 'ai', 'ownership', 'dependencies', 'unknowns', 'evidence'] as const;
export type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  summary: 'Summary',
  questions: 'Questions',
  findings: 'Findings',
  ai: 'AI evidence',
  ownership: 'Ownership',
  dependencies: 'Dependencies',
  unknowns: 'Unknowns',
  evidence: 'Evidence index',
};

function loc(e: EvidenceItem): string {
  const l = e.locator;
  const parts: string[] = [];
  if (l.repository) parts.push(`${l.repository}:`);
  if (l.path) parts.push(`${l.path}${l.line ? `:${l.line}` : ''}`);
  if (l.commit) parts.push(`${l.path ? ' @ ' : 'commit '}${l.commit.slice(0, 12)}`);
  if (l.source && !l.path) parts.push(l.source);
  return parts.join('');
}

function EvidenceItems({ ids, index, max = 25 }: { ids: string[]; index: Map<string, EvidenceItem>; max?: number }) {
  const items = ids.map((id) => index.get(id)).filter((e): e is EvidenceItem => !!e);
  if (!items.length) return <p className="small muted">No item-level evidence: this finding is derived from counts or configuration described in its summary.</p>;
  return (
    <ul className="evidence-list">
      {items.slice(0, max).map((e) => (
        <li key={e.id} id={e.id}>
          <State s={e.state} /> {e.evidenceClass ? <span className="pill">{e.evidenceClass.toLowerCase()}</span> : null} <code>{loc(e)}</code>
          {e.extract ? <span className="muted"> — {e.extract}</span> : null}
          <span className="faint small"> · {e.kind} · {e.detector}</span>
        </li>
      ))}
      {items.length > max ? <li className="muted">+{items.length - max} more in the JSON export</li> : null}
    </ul>
  );
}

export function FindingCard({ f, index }: { f: Finding; index: Map<string, EvidenceItem> }) {
  return (
    <article className="finding" id={f.id}>
      <header>
        <Mat m={f.materiality} /> <span className="rule">{f.rule}</span> <h4>{f.title}</h4> <State s={f.state} />
        {f.suppressed ? <span className="pill">suppressed by company</span> : null}
      </header>
      <p>{f.summary}</p>
      {f.suppressed ? <p className="small muted">Suppression reason (company-asserted): {f.suppressed.reason} — {f.suppressed.by}</p> : null}
      <details>
        <summary>Evidence ({f.evidence.length})</summary>
        <EvidenceItems ids={f.evidence} index={index} />
        <p className="small faint">
          Fingerprint <code>{f.fingerprint}</code> · rule v{f.ruleVersion}
          {f.repository ? ` · ${f.repository}` : ''}
          {f.component ? ` · ${f.component}` : ''}
        </p>
      </details>
    </article>
  );
}

function Questions({ d, audience }: { d: Dossier; audience: Audience }) {
  const items = d.questions.flatMap((q) => q.followUps.filter((f) => f.audience === audience).map((f) => ({ q, f })));
  if (!items.length) return <p className="muted">No questions for {audience}.</p>;
  return (
    <ol>
      {items.map(({ q, f }, i) => (
        <li key={`${q.id}-${i}`}>
          {f.text} <span className="faint small">({q.id})</span>
        </li>
      ))}
    </ol>
  );
}

export function DossierView({ d, view, base, downloads, extra }: { d: Dossier; view: View; base: string; downloads: string; extra?: React.ReactNode }) {
  const index = new Map(d.evidence.map((e) => [e.id, e]));
  const active = d.findings.filter((f) => !f.suppressed);
  const top = d.summary.topFindings.map((id) => d.findings.find((f) => f.id === id)).filter((f): f is Finding => !!f);
  const materialUnknowns = d.unknowns.filter((u) => u.material);
  const a = d.aiDevelopment;
  const tab = (v: View) => `${base}${base.includes('?') ? '&' : '?'}view=${v}`;

  return (
    <div>
      <div className={`verdict ${d.readiness.level}`}>
        <div className="level">{d.readiness.level}</div>
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>{d.summary.headline}</p>
          <ul>
            {d.readiness.reasons.slice(0, 6).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="counts">
        {(['blocking', 'material', 'minor', 'info'] as const).map((m) => (
          <div key={m}>
            <span className="n">{d.summary.counts[m]}</span>
            <span className="l">{m}</span>
          </div>
        ))}
        <div>
          <span className="n">{materialUnknowns.length}</span>
          <span className="l">material unknowns</span>
        </div>
      </div>

      <div className="row small">
        <span className="muted">Download:</span>
        <a href={`${downloads}/html`}>Dossier (HTML)</a>
        <a href={`${downloads}/json`}>JSON</a>
        <a href={`${downloads}/sbom`}>CycloneDX SBOM</a>
        <a href={`${downloads}/envelope`}>Signed manifest (DSSE)</a>
      </div>
      {extra}

      <nav className="tabs" aria-label="Dossier sections">
        {VIEWS.map((v) => (
          <Link key={v} href={tab(v)} aria-current={view === v ? 'page' : undefined}>
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      {view === 'summary' ? (
        <section>
          {d.summary.paragraphs.map((p, i) => {
            const idx = p.indexOf(': ');
            return idx > 0 && idx < 40 ? (
              <p key={i}>
                <strong>{p.slice(0, idx)}.</strong> {p.slice(idx + 2)}
              </p>
            ) : (
              <p key={i}>{p}</p>
            );
          })}
          <h3>Why: top material findings</h3>
          {top.length ? top.map((f) => <FindingCard key={f.id} f={f} index={index} />) : <p className="muted">No material findings.</p>}
          <h3>Unknown: what this analysis could not establish</h3>
          {materialUnknowns.length ? (
            <ul>
              {materialUnknowns.map((u) => (
                <li key={u.id}>
                  <strong>{u.statement}.</strong> <span className="muted">{u.why}</span> <span className="small">Resolve: {u.resolveBy}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No material unknowns.</p>
          )}
        </section>
      ) : null}

      {view === 'questions' ? (
        <section>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Status</th>
                  <th>Evidence</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {d.questions.map((q) => (
                  <tr key={q.id} id={q.id}>
                    <td>
                      <span className="rule">{q.id}</span> {q.question}
                    </td>
                    <td><Status s={q.status} /></td>
                    <td><State s={q.state} /></td>
                    <td className="small">{q.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid3">
            <div className="card"><h3>For management</h3><Questions d={d} audience="management" /></div>
            <div className="card"><h3>For counsel</h3><p className="small muted">Technical findings and escalation prompts; not legal advice.</p><Questions d={d} audience="counsel" /></div>
            <div className="card"><h3>For engineering</h3><Questions d={d} audience="engineering" /></div>
          </div>
        </section>
      ) : null}

      {view === 'findings' ? (
        <section>
          {active.length ? active.map((f) => <FindingCard key={f.id} f={f} index={index} />) : <p className="muted">No findings.</p>}
          {d.findings.length > active.length ? (
            <>
              <h3>Suppressed by the company</h3>
              {d.findings.filter((f) => f.suppressed).map((f) => <FindingCard key={f.id} f={f} index={index} />)}
            </>
          ) : null}
        </section>
      ) : null}

      {view === 'ai' ? (
        <section>
          <p className="notice">These are counts of evidence, not an estimate of how much code was written by AI. A file with no evidence is <strong>unknown</strong>, not human-written.</p>
          <div className="card">
            <div className="ladder">
              {(
                [
                  ['Direct, line-level', a.files.direct_line, 'Machine-readable attribution (git-ai notes, Agent Trace) ties current lines to an AI tool.'],
                  ['Direct, commit-level', a.files.direct_commit, 'Changed in commits whose metadata names an AI tool. Says a tool took part, not which lines.'],
                  ['Corroborating only', a.files.corroborating, 'A self-declared comment in the file.'],
                  ['Inference only', a.files.inference, 'A heuristic signal. A reason to ask, not evidence.'],
                  ['No evidence either way', a.files.none, 'Unknown.'],
                ] as const
              ).map(([label, n, desc]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <strong>{label}</strong>
                  <span className="n">{n}</span>
                  <span className="desc small muted">{desc}</span>
                </div>
              ))}
            </div>
            <p className="small muted">Of {a.filesConsidered} first-party source and test files.</p>
          </div>
          <dl className="kv">
            <dt>Lines with line-level AI attribution</dt>
            <dd>{a.lines.aiAttributed ?? 'not recorded'}</dd>
            <dt>Lines with line-level human attribution</dt>
            <dd>{a.lines.humanAttributed ?? 'not recorded'}</dd>
            <dt>Current lines from AI-attributed commits</dt>
            <dd>{a.lines.fromAiAttributedCommits ?? 'n/a'}{a.lines.total !== null ? ` of ${a.lines.total} blamed lines` : ''}</dd>
            <dt>AI-attributed commits</dt>
            <dd>{a.commits.withDirectEvidence} of {a.commits.total} ({a.commits.directEvidenceViaPullRequest} via pull request or merge, {a.commits.directEvidencePushedDirectly} pushed directly)</dd>
            <dt>Review approvals</dt>
            <dd>{a.reviews.source === 'forge' ? `${a.reviews.approvedByOther} approved by another person; ${a.reviews.notApproved} without` : 'unknown (forge API not connected)'}</dd>
          </dl>
          <h3>Tools</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tool</th><th>Signals</th><th>Commits</th><th>Models</th><th>Declared terms</th></tr></thead>
              <tbody>
                {a.tools.map((t) => (
                  <tr key={t.tool}>
                    <td>{t.tool}{t.vendor ? <span className="faint small"> · {t.vendor}</span> : null}</td>
                    <td className="small">{t.signals.join(', ')}</td>
                    <td>{t.commits}</td>
                    <td className="small">{t.models.join(', ') || '—'}</td>
                    <td className="small">{t.declared ? <>{Object.entries(t.declared).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${String(v)}`).join('; ')} <State s="USER_ASSERTED" /></> : <State s="UNKNOWN" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.filter((f) => f.area === 'ai_development').map((f) => <FindingCard key={f.id} f={f} index={index} />)}
          <h3>Files with AI evidence</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Class</th><th>AI lines</th><th>Human lines</th><th>Tools</th><th>State</th></tr></thead>
              <tbody>
                {d.files.filter((f) => f.ai && f.ai.category !== 'none').slice(0, 300).map((f) => (
                  <tr key={`${f.repository ?? ''}/${f.path}`}>
                    <td><code>{f.repository ? `${f.repository}/` : ''}{f.path}</code></td>
                    <td className="small">{f.ai!.category.replace('_', ' ')}</td>
                    <td>{f.ai!.aiLines ?? '—'}</td>
                    <td>{f.ai!.humanLines ?? '—'}</td>
                    <td className="small">{f.ai!.tools.join(', ') || '—'}</td>
                    <td><State s={f.ai!.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {view === 'ownership' ? (
        <section>
          <p className="muted">History: {d.ownership.historyCoverage}. {d.ownership.registerSupplied ? 'Agreement data comes from the company-supplied register.' : 'No IP register supplied: agreement status is unknown.'}</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Contributor</th><th>Identities</th><th>Class</th><th>Commits</th><th>Active</th><th>Agreement</th></tr></thead>
              <tbody>
                {d.ownership.contributors.filter((c) => c.class !== 'bot').slice(0, 300).map((c) => (
                  <tr key={c.id}>
                    <td>{c.displayName}{c.mergeState === 'INFERRED' ? <span className="faint small"> (merged by name)</span> : null}</td>
                    <td className="small">{c.identities.map((i) => i.email || i.name).join(', ')}</td>
                    <td className="small">{c.class.replace(/_/g, ' ')} <State s={c.classState} /></td>
                    <td>{c.commits}</td>
                    <td className="small">{c.firstCommitAt.slice(0, 10)} – {c.lastCommitAt.slice(0, 10)}</td>
                    <td className="small">{c.agreement ? <>{c.agreement.type.replace(/_/g, ' ')}{c.agreement.signedOn ? ` (${c.agreement.signedOn})` : ''} <State s={c.agreement.state} /></> : <State s="UNKNOWN" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.filter((f) => f.area === 'ownership' || f.area === 'provenance').map((f) => <FindingCard key={f.id} f={f} index={index} />)}
        </section>
      ) : null}

      {view === 'dependencies' ? (
        <section>
          <dl className="kv">
            <dt>Project license</dt>
            <dd>{d.licenses.project.expression ?? 'not declared'} · {d.licenses.project.certainty.toLowerCase()} <State s={d.licenses.project.state} /></dd>
            <dt>Distribution model</dt>
            <dd>{d.declarations.distribution ? <>{d.declarations.distribution} <State s="USER_ASSERTED" /></> : 'not declared (copyleft obligations depend on it)'}</dd>
            <dt>Dependency licenses</dt>
            <dd>Known {d.licenses.known} · likely {d.licenses.likely} · unknown {d.licenses.unknown}</dd>
          </dl>
          {active.filter((f) => f.area === 'licenses' || f.area === 'security' || f.area === 'reproducibility').map((f) => <FindingCard key={f.id} f={f} index={index} />)}
          <h3>All dependencies ({d.dependencies.length})</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Package</th><th>Version</th><th>Scope</th><th>License</th><th>Certainty</th><th>Component</th></tr></thead>
              <tbody>
                {d.dependencies.slice(0, 1000).map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}{x.private ? <span className="faint small"> · private</span> : null}{x.direct ? '' : <span className="faint small"> · transitive</span>}</td>
                    <td className="small">{x.version ?? x.requirement ?? '—'}</td>
                    <td className="small">{x.scope}</td>
                    <td className="small">{x.license?.expression ?? '—'}</td>
                    <td className="small">{x.license?.certainty ?? 'UNKNOWN'}</td>
                    <td className="small">{x.component}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {view === 'unknowns' ? (
        <section>
          <p className="muted">Unknowns are never counted as clean.</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Area</th><th>Unknown</th><th>Why</th><th>How to resolve</th><th>Material</th></tr></thead>
              <tbody>
                {d.unknowns.map((u) => (
                  <tr key={u.id}>
                    <td className="small">{u.area.replace(/_/g, ' ')}</td>
                    <td>{u.statement}</td>
                    <td className="small muted">{u.why}</td>
                    <td className="small">{u.resolveBy}</td>
                    <td>{u.material ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Coverage</h3>
          <dl className="kv">
            <dt>Files read in full</dt><dd>{d.coverage.filesContentScanned} of {d.coverage.filesTotal}</dd>
            <dt>History</dt><dd>{d.coverage.history.available ? `${d.coverage.history.commitsAnalyzed} commits${d.coverage.history.shallow ? ' (shallow)' : ''}${d.coverage.history.truncated ? ' (truncated)' : ''}` : 'not available'}</dd>
            <dt>Secrets in history</dt><dd>{d.coverage.secretsHistoryScan.performed ? `${d.coverage.secretsHistoryScan.blobsScanned} earlier file versions scanned` : 'not scanned'}</dd>
            <dt>Enrichment</dt><dd>{d.coverage.enrichment.map((e) => `${e.source}: ${e.performed ? `queried ${e.queriedAt ?? ''}` : e.reason ?? 'not performed'}`).join(' · ')}</dd>
          </dl>
        </section>
      ) : null}

      {view === 'evidence' ? (
        <section>
          <p className="muted">{d.evidence.length} evidence items. Extracts are short structured values, never source code or secrets.</p>
          <EvidenceItems ids={d.evidence.map((e) => e.id)} index={index} max={1500} />
        </section>
      ) : null}
    </div>
  );
}

export function parseView(v: string | string[] | undefined): View {
  return typeof v === 'string' && (VIEWS as readonly string[]).includes(v) ? (v as View) : 'summary';
}
