import Link from 'next/link';
import { dossierDigest, READINESS_SCOPE, type Dossier } from '@acquicode/engine';
import { Footer, Mat, State, TopBar } from '@/components/ui';
import { currentUser } from '@/lib/session';
import { PLANS } from '@/lib/plans';
import { sampleDossier } from '@/lib/sample';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** A real excerpt of the sample dossier, rendered from the engine's output rather than drawn. */
function DossierPreview({ d }: { d: Dossier }) {
  const top = d.findings.filter((f) => !f.suppressed && (f.materiality === 'blocking' || f.materiality === 'material')).slice(0, 3);
  const c = d.summary.counts;
  return (
    <figure className="preview" style={{ margin: 0 }} aria-label="Excerpt of the sample dossier">
      <div className="bar-top"><span className="dot" /><span className="dot" /><span className="dot" /><span style={{ marginLeft: '0.4rem' }}>Meridian Systems · synthetic demo company</span></div>
      <div className="body">
        <div className={`verdict ${d.readiness.level}`}>
          <div className="level">{d.readiness.level}</div>
          <div className="small" style={{ fontWeight: 600 }}>{d.summary.headline}</div>
        </div>
        <div className="counts">
          <div><span className="n">{c.blocking}</span><span className="l">blocking</span></div>
          <div><span className="n">{c.material}</span><span className="l">material</span></div>
          <div><span className="n">{d.unknowns.filter((u) => u.material).length}</span><span className="l">unknowns</span></div>
          <div><span className="n">{d.aiDevelopment.files.none}</span><span className="l">files: no AI evidence either way</span></div>
        </div>
        {top.map((f) => (
          <div className="finding" key={f.id}>
            <header><Mat m={f.materiality} /><span className="rule">{f.rule}</span><strong>{f.title}</strong><State s={f.state} /></header>
            <p className="muted">{f.summary.length > 150 ? `${f.summary.slice(0, 147)}…` : f.summary}</p>
          </div>
        ))}
        <p className="small" style={{ margin: '0.6rem 0 0' }}><Link href="/sample">Open the full sample dossier →</Link></p>
      </div>
    </figure>
  );
}

export default async function Landing() {
  const [user, sample] = await Promise.all([currentUser(), sampleDossier().catch(() => null)]);
  const s = site();
  const start = user ? '/app/connect' : '/login';
  const digest = sample ? dossierDigest(sample) : null;
  const plans = PLANS.filter((p) => p.id !== 'enterprise');
  const enterprise = PLANS.find((p) => p.id === 'enterprise')!;
  return (
    <>
      <TopBar signedIn={!!user} />
      <main>
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <div className="kicker">Technical due diligence for AI-built software</div>
              <h1>Know what a buyer will find in your code before they look.</h1>
              <p className="lead">
                AcquiCode tells you what your software contains, who wrote it, which AI tools shaped it and what an acquirer will ask about it. Every claim is
                tied to evidence. Every unknown stays unknown.
              </p>
              <div className="row">
                <Link className="btn primary" href={start}>Analyze a repository</Link>
                <Link className="btn" href="/sample">See a sample dossier</Link>
              </div>
              <p className="small muted" style={{ marginTop: '1rem' }}>
                Minutes, not weeks. No sales call. Or <Link href="/cli">run the free CLI</Link> where your code lives and nothing leaves your machine.
              </p>
            </div>
            {sample ? <DossierPreview d={sample} /> : null}
          </div>
        </section>

        <section className="section">
          <div className="wrap grid2">
            <div>
              <h2>Buyers now ask two questions about AI-built code</h2>
              <p>How much of this was produced with AI tools? And, more importantly, what share was reviewed by a person who understood it?</p>
              <p className="muted">
                Most founders cannot answer either. Tools that &ldquo;detect&rdquo; AI-written code give you a percentage that is a guess, and a wrong number in a
                transaction document is a liability. Even attribution written by tools can be wrong: some editors have stamped AI co-authors on commits with no AI
                involvement.
              </p>
              <p>AcquiCode does not guess. It collects the evidence that exists (coding-agent trailers, agent-authored commits, git-ai line attribution, Agent Trace records, review approvals) and grades it.</p>
            </div>
            <div className="card">
              <h3>The evidence ladder</h3>
              <div className="ladder">
                <strong>Direct, line-level</strong><span className="n">✓</span><span className="desc small muted">Machine-readable records tie specific lines to a tool.</span>
                <strong>Direct, commit-level</strong><span className="n">✓</span><span className="desc small muted">A commit written by, or naming, the agent that made it.</span>
                <strong>Corroborating</strong><span className="n">~</span><span className="desc small muted">Self-declared comments, tool configuration, editor-inserted trailers.</span>
                <strong>Inference</strong><span className="n">?</span><span className="desc small muted">A reason to ask. Never counted as evidence, never blocks a deal.</span>
                <strong>No evidence</strong><span className="n">—</span><span className="desc small muted">Unknown. Not &ldquo;human&rdquo;.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <h2>How it works</h2>
            <ol className="steps">
              <li>
                <h3>Connect, or run the CLI</h3>
                <p className="small">Install the GitHub App on the repositories you choose, connect GitLab, upload an archive, or run the CLI in CI so the code never leaves your machine.</p>
              </li>
              <li>
                <h3>Fix what you can, declare what you can&apos;t</h3>
                <p className="small">Rotate the exposed key, pin the action, record your AI tools and their terms, upload the IP register. Re-scan until what is left is what you intend to disclose.</p>
              </li>
              <li>
                <h3>Share a dossier the buyer can verify</h3>
                <p className="small">Send a read-only link to the buyer and their counsel. The dossier is signed, and anyone with access to the same commits can reproduce it byte for byte.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <h2>What the dossier answers</h2>
            <div className="grid3">
              <div className="card"><h3>Ownership</h3><p className="small">Everyone who committed code, under which addresses, matched against your IP-assignment register. Contractors on personal emails and work that predates a signature are called out for counsel.</p></div>
              <div className="card"><h3>Licenses &amp; third-party code</h3><p className="small">Dependency licenses with their certainty, copyleft given your distribution model, copied snippets (Stack Overflow is CC BY-SA), foreign copyright notices, unlicensed vendored code.</p></div>
              <div className="card"><h3>Exposure</h3><p className="small">Credentials in code and history (values never reproduced), material vulnerabilities, CI pipelines that run untrusted code, dependency confusion.</p></div>
              <div className="card"><h3>Reproducibility</h3><p className="small">Are the inputs needed to rebuild the software declared and pinned: lockfiles, drift, container digests, committed binaries.</p></div>
              <div className="card"><h3>AI development</h3><p className="small">Which tools, on which code, reviewed by whom, under which terms (indemnities depend on the plan tier), and where the records contradict what the company says.</p></div>
              <div className="card"><h3>What is still unknown</h3><p className="small">A separate list of what could not be established, why, and how to resolve it, with questions routed to management, counsel and engineering.</p></div>
            </div>
          </div>
        </section>

        <section className="section" id="buyers">
          <div className="wrap grid2">
            <div>
              <div className="kicker">For acquirers and investors</div>
              <h2 style={{ marginTop: '0.4rem' }}>Ask your target for a dossier, not their code</h2>
              <p>Targets rarely hand source code to a buyer directly. With AcquiCode you send a request instead:</p>
              <ul className="lede-list">
                <li>Create a request for each target; it comes with a token that can only deliver one dossier to you, and cannot read anything.</li>
                <li>The target runs the analysis in their own CI or on a laptop and pushes the signed result.</li>
                <li>You see what arrived, whether the signature checks out, and every question the dossier raises, routed to your deal team, counsel and engineers.</li>
              </ul>
              <p><Link className="btn" href={user ? '/app/requests' : '/login'}>Request a dossier</Link></p>
            </div>
            <div className="card">
              <h3>What a buyer gets that a questionnaire cannot give</h3>
              <ul className="lede-list small">
                <li><strong>Evidence, graded.</strong> Each answer states whether it was observed, derived, asserted by the company, inferred or unknown.</li>
                <li><strong>Contradictions surfaced.</strong> Where the company&apos;s declarations disagree with the repository, the dossier says so.</li>
                <li><strong>A verifiable artifact.</strong> A signature binds the dossier to the commits it describes; reproduction proves it matches the code.</li>
                <li><strong>A history.</strong> Snapshots over time show what changed between signing and close.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap grid2">
            <div>
              <h2>Deterministic, so it can be verified</h2>
              <p>
                There is no language model in the analysis. The same commits and the same analyzer always produce the same dossier digest, so a buyer, their
                counsel or an independent reviewer can re-run it and check.
              </p>
              <p className="muted small">{READINESS_SCOPE}</p>
            </div>
            {sample && digest ? (
              <pre aria-label="Output from the sample repository">{`# Output for the Meridian demo repository
$ acquicode scan . --sign-key acquicode-signing.key.pem
${sample.readiness.level}  ${sample.summary.headline}
  AI evidence (files): ${sample.aiDevelopment.files.direct_line} line-level, ${sample.aiDevelopment.files.direct_commit} commit-level,
                       ${sample.aiDevelopment.files.inference} inference-only, ${sample.aiDevelopment.files.none} no evidence
  digest ${digest.slice(0, 40)}…

$ acquicode verify dossier.json --reproduce ./meridian
reproduced digest ${digest.slice(0, 12)}…: MATCHES`}</pre>
            ) : null}
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="wrap">
            <h2>Pricing</h2>
            <p className="muted">A sell-side technical review costs $5,000–$30,000 and takes weeks. AcquiCode is the first pass you run before anyone else does.</p>
            <div className="grid4">
              {plans.map((p) => (
                <div className={`card plan${p.id === 'readiness' ? ' featured' : ''}`} key={p.id}>
                  <h3>{p.name}</h3>
                  <div className="price">{p.price} <span className="small muted">{p.cadence}</span></div>
                  <p className="small muted">{p.audience}</p>
                  <ul className="small">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                  <Link className={`btn${p.id === 'readiness' ? ' primary' : ''}`} href={user ? '/app/settings#billing' : '/login'}>{p.id === 'free' ? 'Start free' : `Choose ${p.name}`}</Link>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: '1rem' }}>
              {enterprise.name}: {enterprise.features.join('; ').toLowerCase()}.{' '}
              {s.supportEmail ? <>Write to <a href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>.</> : 'Contact the operator of this deployment.'}
            </p>
          </div>
        </section>

        <section className="section">
          <div className="wrap narrow">
            <h2>Questions</h2>
            <h3>Do you detect AI-written code?</h3>
            <p>No. Detection of AI-written code is an open research problem, and a percentage based on it would be a guess presented as a fact. We report the evidence that exists and label everything else unknown.</p>
            <h3>What if my repository records no AI attribution at all?</h3>
            <p>Then the dossier says so, and the AI section is mostly &ldquo;unknown&rdquo;. That is still useful: it tells you what a buyer will ask, and how to start recording attribution (git-ai or Agent Trace) so the next snapshot can answer.</p>
            <h3>Is this legal advice?</h3>
            <p>No. The dossier states technical facts and their certainty, and turns them into questions for your counsel.</p>
            <h3>What happens to my code?</h3>
            <p>With the CLI, nothing leaves your machine. With hosted analysis, the repository is cloned into an isolated working directory with a short-lived read-only token, analysed, and deleted; only the dossier is kept, encrypted, for your retention period. No model is trained on it and no language model reads it. <Link href="/security">Details</Link>.</p>
            <h3>What does READY mean?</h3>
            <p>Every diligence question is answered and nothing material is unknown. It is deliberately hard to reach: you need history, declarations, a contributor register and a vulnerability check, not just clean code. It is never a statement that the software is secure or free of legal risk.</p>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="cta-band">
              <div>
                <h2>Find out before your buyer does</h2>
                <p className="muted" style={{ margin: 0 }}>Your first repository is free. The sample dossier shows exactly what you will get.</p>
              </div>
              <div className="row">
                <Link className="btn primary" href={start}>Analyze a repository</Link>
                <Link className="btn" href="/sample">See a sample dossier</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
