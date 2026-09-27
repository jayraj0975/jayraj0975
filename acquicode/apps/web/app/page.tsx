import Link from 'next/link';
import { Footer, TopBar } from '@/components/ui';
import { currentUser } from '@/lib/session';
import { PLANS } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export default async function Landing() {
  const user = await currentUser();
  return (
    <>
      <TopBar signedIn={!!user} />
      <main>
        <section className="hero">
          <div className="wrap">
            <div className="kicker">Technical due diligence for AI-built software</div>
            <h1>Know what a buyer will find in your code before they look.</h1>
            <p className="lead">
              AcquiCode establishes what your software contains, where it came from, and what an investor or acquirer should worry about. Every claim is tied to evidence.
              Every unknown stays unknown.
            </p>
            <div className="row">
              <Link className="btn primary" href={user ? '/app/connect' : '/login'}>Analyze a repository</Link>
              <Link className="btn" href="/sample">See a sample dossier</Link>
            </div>
            <p className="small muted" style={{ marginTop: '1rem' }}>No sales call. Or run the CLI where your code lives (<code>acquicode scan .</code>) and nothing leaves your machine.</p>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap grid2">
            <div>
              <h2>Buyers now ask two questions about AI-built code</h2>
              <p>How much of this was produced with AI tools? And, more importantly, what share was reviewed by a person who understood it?</p>
              <p className="muted">
                Most founders cannot answer either. Tools that &ldquo;detect&rdquo; AI-written code give you a percentage that is a guess, and a wrong number in a transaction document is a liability.
              </p>
              <p>AcquiCode does not guess. It collects the evidence that exists (commit trailers from coding agents, agent-authored commits, git-ai line attribution, Agent Trace records, review approvals) and grades it.</p>
            </div>
            <div className="card">
              <h3>The evidence ladder</h3>
              <div className="ladder">
                <strong>Direct, line-level</strong><span className="n">✓</span><span className="desc small muted">Machine-readable records tie specific lines to a tool.</span>
                <strong>Direct, commit-level</strong><span className="n">✓</span><span className="desc small muted">A commit names the tool that took part.</span>
                <strong>Corroborating</strong><span className="n">~</span><span className="desc small muted">Self-declared comments, tool configuration, editor-inserted trailers.</span>
                <strong>Inference</strong><span className="n">?</span><span className="desc small muted">A reason to ask. Never counted as evidence, never blocks a deal.</span>
                <strong>No evidence</strong><span className="n">—</span><span className="desc small muted">Unknown. Not &ldquo;human&rdquo;.</span>
              </div>
            </div>
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

        <section className="section">
          <div className="wrap grid2">
            <div>
              <h2>Runs where your code lives</h2>
              <p>Targets rarely hand source code to a buyer directly. So the analyzer runs in your CI or on your laptop and produces a signed dossier with paths, hashes and metadata, never source.</p>
              <p>The analysis is deterministic: anyone with access to the same commits can re-run it and must get the same digest. That is what lets a buyer trust a dossier the seller produced.</p>
            </div>
            <pre>{`# Example output, from the Meridian demo repository
$ acquicode scan . --sign-key signing.key.pem
BLOCKED  2 findings must be resolved before close; ...
  AI evidence (files): 2 line-level, 4 commit-level,
                       10 inference-only, 10 no evidence
  digest 38eb9d2a83977644d278ce72e60672752e082a01...

$ acquicode verify dossier.json --reproduce ./repo
reproduced digest 38eb9d2a...: MATCHES`}</pre>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="wrap">
            <h2>Pricing</h2>
            <p className="muted">A sell-side technical review costs $5,000–$30,000 and takes weeks. AcquiCode is the first pass you run before anyone else does.</p>
            <div className="grid3">
              {PLANS.filter((p) => p.id !== 'enterprise').map((p) => (
                <div className="card plan" key={p.id}>
                  <h3>{p.name}</h3>
                  <div className="price">{p.price} <span className="small muted">{p.cadence}</span></div>
                  <p className="small muted">{p.audience}</p>
                  <ul className="small">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                  <Link className={`btn${p.id === 'readiness' ? ' primary' : ''}`} href={user ? '/app/settings#billing' : '/login'}>{p.id === 'free' ? 'Start free' : `Choose ${p.name}`}</Link>
                </div>
              ))}
            </div>
            <p className="small muted">Enterprise: run AcquiCode in your own environment with custom limits and retention. SSO and a worker agent for code that must stay on your network are on the roadmap, not yet available. Write to the address on the security page.</p>
          </div>
        </section>

        <section className="section">
          <div className="wrap narrow">
            <h2>Questions</h2>
            <h3>Do you detect AI-written code?</h3>
            <p>No. Detection of AI-written code is an open research problem, and a percentage based on it would be a guess presented as a fact. We report the evidence that exists and label everything else unknown.</p>
            <h3>Is this legal advice?</h3>
            <p>No. The dossier states technical facts and their certainty, and turns them into questions for your counsel.</p>
            <h3>What happens to my code?</h3>
            <p>With the CLI, nothing leaves your machine. With hosted analysis, the repository is cloned into an isolated working directory with a short-lived read-only token, analysed, and deleted; only the dossier is kept, encrypted, for your retention period. No model is trained on it and no language model reads it. <Link href="/security">Details</Link>.</p>
            <h3>What does READY mean?</h3>
            <p>Every diligence question is answered and nothing material is unknown. It is deliberately hard to reach: you need history, declarations, a contributor register and a vulnerability check, not just clean code.</p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
