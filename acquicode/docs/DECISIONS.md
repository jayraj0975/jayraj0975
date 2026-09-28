# Decisions

Each decision records what we believed, what attacked it, and what we chose. Newest last. Evidence referenced here is sourced in MARKET.md and COMPETITORS.md.

---

## D1. Attack the original idea before building it

The original thesis: "AI-native software ownership and technical due-diligence infrastructure" that produces an "AI Software Ownership & Risk Dossier", headlined by how much of a codebase AI wrote.

### Customer attack

| Persona | Would they pay? | Why / why not | Verdict |
|---|---|---|---|
| Founder raising a Series A | Rarely | Series A diligence rarely includes code scans (ASSUMPTION). "Could an engineer do it in a day?" Mostly yes for this depth. | **Demoted** |
| Founder preparing an acquisition | Yes | Surprises in buyer DD move price (saas.group claims 15-30%); Black Duck finds license conflicts in 94% of deals. A self-run check before the buyer's audit is cheap insurance. | **Primary ICP** |
| CTO inheriting an AI-built codebase | Maybe | Cares about maintainability and security more than provenance. Served by the same dossier; not the buyer we design for. | Secondary |
| Startup / M&A lawyer | Won't pay for software, will use it | Needs facts for disclosure schedules: who contributed, under what agreement, which licenses, which AI tools under which terms. Cannot produce them. | **Channel** |
| VC technical-diligence lead | Some | Wants a 10-minute red-flag read. Useful for later-stage and growth deals. | Secondary |
| Corporate M&A technical reviewer | Yes, sales-led | 400 repos, one week. Needs triage, not a PDF per repo. | Expansion |

"What report would make me pay immediately?" The answer from the seller side: *a list of the things a buyer's auditor will find, with the evidence, before the auditor finds them, and the exact questions my counsel will be asked.* From the buyer side: *a document I can trust without receiving the code.*

**Features killed by the customer attack:**
- A headline "X% of this code was written by AI". Detection is unreliable (it is an open research problem, e.g. [SemEval-2026 Task 13](https://arxiv.org/pdf/2604.26990)), Sema already sells detection, and a wrong number in a transaction document is a liability. Replaced by *evidence-graded attribution*: counts of files with direct evidence, corroborating evidence, inference only, and no evidence, each drillable to the evidence.
- A generic vulnerability dashboard. Snyk/GitHub own it. We keep only findings that are transaction-material.
- "AI-powered insights". No one pays for them in a transaction document and they introduce non-determinism and prompt-injection surface.

**Feature added by the customer attack:** the contributor register. Every buyer asks for IP assignment agreements from everyone who contributed code; nobody has a clean list of who contributed. Git history gives one, with dates, volumes and email-domain classes. Matching it against a user-supplied register of signed agreements (USER_ASSERTED) is precise, cheap, and exactly what counsel needs.

**Feature added (buyer evidence):** human review evidence. The acquirer quoted in MARKET.md cares more about "what share was reviewed by a human who understood it" than the AI share. We report merge/PR evidence and, where the forge API is connected, review approvals by someone other than the author.

### Enterprise attack (acquirer's CTO, CISO, counsel, procurement, DPO, VP Eng, integration lead)

| Objection | What would make the report unusable | Redesign |
|---|---|---|
| "You want our source code?" | Targets don't share code with acquirers (Black Duck). | **Local-first analyzer.** The scanner runs where the code lives (CLI, CI job, self-hosted worker). It emits an evidence bundle with paths, hashes and metadata; no source content leaves by default. Hosted scanning exists for self-serve founders and deletes the clone after analysis. |
| "Why should the buyer trust a seller-run scan?" | Tampering. | **Reproducibility as verification.** Deterministic output; the dossier digest is bound to commit SHAs. Anyone with code access can re-run the open analyzer on the same commits and must get the same digest. Attestation levels: SELF_ATTESTED, PLATFORM_ATTESTED (our runner fetched from the forge), REPRODUCED. |
| False positives | Reviewers stop reading. | Every finding carries evidence locators, provenance state and a rule ID+version. Suppressions require a reason and are part of the signed record. |
| Provenance uncertainty, missing AI logs | Report implies "no evidence" means "human". | UNKNOWN is a first-class state and is counted and shown, never folded into a "human" bucket. |
| Incomplete git history (shallow, squashed, imported) | Ownership claims on partial history. | History coverage is measured (shallow boundary, grafts, bulk "initial import" commits) and every ownership/provenance section states its coverage. |
| Proprietary/private packages | Enrichment leaks internal package names to public registries. | Private packages detected (scopes, registry config, `private: true`) and never sent to external services. Network enrichment is opt-in and listed in the dossier. |
| Copyleft | Tool gives a legal conclusion. | We report license facts, dependency scope (prod/dev), and the user-declared distribution model, then generate *questions for counsel*. No legal conclusions. |
| Generated artifacts, vendored code, binaries, submodules | Silent blind spots. | Each is inventoried. Binaries and submodule contents are declared opaque (UNKNOWN), not ignored. |
| Monorepos | One verdict for 40 components. | Per-manifest components; findings keyed to components. |
| SBOM accuracy | An SBOM that claims completeness it lacks. | CycloneDX export with explicit `compositions` (complete / incomplete / unknown) per ecosystem. |
| Data retention, DPO | Code retained or used for training. | Clone deleted after scan; no training on customer data; configurable retention; hard delete; audit log. |
| AI model provider exposure | Customer code sent to an LLM vendor. | No LLM in the pipeline. |
| Auditability | Cannot show what the tool did. | Analyzer version, rule versions, inputs, limits and coverage are in the signed manifest. |

### Competitor attack
See COMPETITORS.md §2. Surviving moat candidates: contemporaneous evidence history, reproducibility-based verification, two-sided format adoption, outcome corpus. None exists on day one.

### Investor attack

| Question | Honest answer |
|---|---|
| Why now? | Human-authorship rule settled in the US (March 2026); AI attribution formats exist for the first time (Agent Trace Jan 2026, git-ai, default trailers); buyers now ask. Not regulation: the EU AI Act excludes source code from Art. 50(2). |
| Why doesn't GitHub/Snyk own it? | GitHub is not neutral and not cross-forge; Snyk is a remediation tool. Black Duck could own it and is the main threat. |
| Is the buyer recurring? | The transaction is episodic. Recurrence has to come from continuous custody during a process and post-close, and from buyers running many deals. Unproven (ASSUMPTION A3). |
| Is this a feature? | The scanners are features. The evidence model + verification protocol + transaction workflow is a product. Whether it is a company depends on A1-A3. |
| TAM? | Not published; see MARKET.md §4. The one-time wedge alone is not venture scale in our scenario math. |
| Can it scale without humans? | Yes by design: deterministic analysis, templated narrative, self-serve. Humans only for enterprise onboarding. |
| What proprietary data accumulates? | Signed snapshot histories per customer; opt-in anonymised finding/outcome corpus. |
| What happens when AI coding is universal? | "Was AI used" stops being interesting. "Which code has recorded human authorship and review, under which tool terms" stays interesting as long as the human-authorship rule and indemnity conditions exist. The broader chain-of-title and OSS questions remain regardless. |

### Corporate attack (Fortune 500, $50M AI startup, 400 repos, one week)
Required output: what do we know, what can we prove, what is uncertain, what is transaction risk, what goes to legal, what goes to engineering, what is safe, what blocks integration. **Design consequence:** the dossier is organised around diligence questions, each answered with a state, evidence and an audience (management, counsel, engineering), and the tool can scan many repositories into one organisation-level view with a cross-repo contributor register (the 20 contractors appear once, with every repo they touched).

---

## D2. Final direction

**Keep:** AcquiCode (name). `acquicode.com` was not registered as of the Instant Domain Search index, and a fuzzy USPTO search in classes 9/42 returned no live conflicting mark (only ACUCODE, acupuncture billing). This is not legal clearance.

**Category:** evidence-graded technical diligence for AI-built software.

**Wedge:** sell-side readiness. A company preparing to be acquired runs AcquiCode (hosted or local) and gets a Diligence Dossier before the buyer's audit. **Second side:** a buyer receives the signed dossier, verifies it, and sees the open questions.

**Recurring layer:** continuous custody (signed snapshots on every push or on a schedule, "what materially changed since the last diligence snapshot") during a sale process and post-close.

**Killed:** AI% detection; Series A as ICP; security dashboard; LLM in the pipeline; upload-by-default for enterprise; "regulation requires this" positioning.

## D3. No LLM in the analysis or the narrative
Deterministic scanners and rule-based evaluation; the executive summary is generated from templates bound to evidence states. Reasons: determinism (verification protocol), confidentiality, no prompt-injection surface, and no model vendor exposure. Revisit only for optional, clearly-labelled features that never write into the signed dossier.

## D4. Provenance states are a lattice, and roll-ups can only weaken
States: VERIFIED > OBSERVED > DERIVED > USER_ASSERTED > INFERRED, plus UNKNOWN, CONFLICTING, UNVERIFIABLE, STALE. A derived claim is never stronger than its weakest input; absence of evidence yields UNKNOWN, never a negative. This is enforced in code and by property tests. See PROVENANCE.md.

## D5. Readiness is conservative
READY only when every question is satisfied or not applicable **and** no material unknown remains. BLOCKED only from observed or verified evidence, never from inference. UNKNOWN produces REVIEW.

## D6. Stack
TypeScript end to end (one language for a tiny team, shared types between engine and UI). Next.js for the web app, PostgreSQL for data, job queue (`FOR UPDATE SKIP LOCKED`) and tenant isolation (row-level security), S3-compatible or filesystem storage for artifacts. No Redis, no Kubernetes requirement. The engine shells out to `git` with hooks disabled and never executes repository code.

## D7. GitHub App, not OAuth App
Per-repository selection by the customer, short-lived installation tokens minted per job (built-in rotation), push webhooks for continuous mode, read-only permissions (contents, metadata, pull requests). GitLab via project access token; ZIP upload for everything else (with history-dependent sections declared UNKNOWN).

## D8. Signed output uses existing standards
DSSE envelope over an in-toto Statement v1 with an AcquiCode predicate; Ed25519 keys. SBOM as CycloneDX 1.6 with compositions. Provenance ingestion of Agent Trace records and git-ai `authorship/3.x` notes. We do not invent formats where one exists.

## D9. Initial pricing (to be tested, not validated)
Anchors: consultants $5k-$30k per target; Sema $33/dev/month; Snyk $25/dev/month; escrow from $125/month.

| Plan | Price | For |
|---|---|---|
| Local | Free | CLI and CI: full dossier, self-attested, evidence never leaves. Distribution and trust. |
| Readiness | $1,500 per dossier (up to 10 repositories, re-scans for 90 days) | Sellers before a process |
| Custody | $490/month (up to 25 repositories) | Companies within 24 months of a raise/exit; post-close |
| Acquirer | $750 per requested target, or $2,500/month for up to 6 active targets | Aggregators, search funds, PE |
| Enterprise / API | Custom | 400-repo targets, self-hosted worker, SSO |

Rejected: the brief's $499 snapshot (priced below the cost of one buyer-side question and signals "toy"), and per-developer pricing (the seller's developer count is irrelevant to the value of a transaction document).

---

## D10. Second research loop: attribution written by tools is not attribution
**Found:** VS Code 1.117 (April 2026) made its `Co-authored-by: Copilot <copilot@github.com>` trailer the default and, through a bug, added it to commits with no AI involvement; its intended mode fires on a single suggested word ([microsoft/vscode#314311](https://github.com/microsoft/vscode/issues/314311)). Our engine counted that trailer as DIRECT evidence. That is exactly the "uncertainty turned into certainty" release blocker: a company that disabled AI could have been shown as contradicting its own "no AI" declaration.
**Chose:** commit signals carry a reliability. Editor-inserted trailers are CORROBORATING evidence, the tool use they imply is INFERRED, and new rule AI-013 asks the question. Invariants I11 and I12 make the regression impossible to ship silently.
**Repositioning consequence:** the moat is not "reading trailers" (anyone can grep); it is *grading* evidence and refusing to over-claim. Tools that count trailers as attribution now produce wrong answers for a documented class of repositories.

## D11. Second research loop: Black Duck sells to sellers, and covers AI
**Found:** Black Duck's M&A page (updated August 2026) lists sellers as a customer group and puts "AI" in audit scope, and says "targets trust Black Duck with their IP".
**Chose:** we no longer claim targets won't share code at all; they share it with trusted third-party auditors. Our differentiation is narrower and more honest:
- **self-serve and minutes, not weeks**, at a fraction of the price;
- **continuous custody**, not a point-in-time audit;
- a **reproducible, signed** artifact a buyer can check;
- **evidence grading** of AI attribution rather than an auditor's opinion.
We should expect to lose large, buy-side, human-audit deals to Black Duck and win the sellers who want to know before anyone looks.

## D12. R&W insurance is a channel to test, not a claim to make
**Found:** Fasken (13 August 2026) expects RWI insurers to push broader AI exclusions when "the diligence record is incomplete", and advises sellers to make AI risk "identifiable and understandable", including IP ownership records. This is a law firm's view, not data.
**Chose:** no marketing claim about insurance. Add brokers and underwriters to the validation list (WHY_NOT.md §3). A dossier that narrows an exclusion would be the strongest demand signal we could find.

## D13. Tenant isolation must survive managed PostgreSQL
**Found in QA:** the SECURITY DEFINER lookups (share links, API tokens, webhooks, invitations) returned nothing when the schema owner was not a superuser, because FORCE RLS binds the owner. It worked in development only because development used a superuser. On RDS or Cloud SQL, share links and the API would have silently failed.
**Chose:** owner-only policies for the definer lookups (migration 002). Migrations refuse an application role that could bypass RLS. The database test suite runs as a non-superuser owner, and so does the compose stack.

## D14. Never trust identifiers a third party can edit
**Found in QA:**
1. The GitHub setup callback trusted `installation_id`, so any admin could bind another customer's installation.
2. Invitations were keyed on usernames, which change hands.
3. The GitLab clone URL was taken from the remote's API response.
**Chose:**
1. Bind an installation only after GitHub confirms the signed-in user can access it, and refuse installations bound elsewhere.
2. Bind invitations to numeric GitHub ids (migration 003).
3. Build clone URLs from the checked host, and pin DNS for the API call and the clone.
Each is covered by a test that replays the attack.

## D15. The worker is a self-contained bundle
The worker, analysis runner, migrations and re-encryption tool are bundled with esbuild, so the container needs no `node_modules` for them. The web app uses Next.js standalone output. One image, three commands. A bug where the worker imported Next.js through a shared error class was found by the end-to-end suite and fixed by moving `HttpError` into a framework-free module.

## D16. Honest defaults over convenient ones
- **Client IPs:** taken from `X-Forwarded-For` only through `TRUST_PROXY` hops, and from the entry the proxy added. Without a proxy they are recorded as unknown, not guessed.
- **Plan features:** state only what exists. "Alerts", "portfolio view", "SSO" and "self-hosted workers" were removed from plan copy until built (ROADMAP.md).
- **Readiness:** every level carries a fixed scope statement, in the app and the export.

## D17. Key rotation includes retirement
Multiple decryption keys alone let you add a key but never remove one. `reencrypt.mjs` re-encrypts credentials and dossier bodies under the current key, idempotently, so the old key can be retired. It is tested end to end.

## D18. A fresh deployment must be usable without hand-copied credentials
Sign-in depends on a GitHub App, and creating one by hand means copying six values between two consoles, where one typo leaves a site nobody can log into. `/setup` uses GitHub's manifest flow instead: one click creates the App with exactly the permissions and URLs AcquiCode needs, and the credentials GitHub returns are stored encrypted. Guarded by `SETUP_TOKEN`, bound to the browser that unlocked it, one-time, closed once an App exists; environment variables always win so infrastructure-as-code deployments are unaffected. Rejected: email magic links (another third party and deliverability problems before the first user) and passwords (a weaker identity than the GitHub account every customer already uses for their code).

## D19. One container for small deployments
Single-service container platforms run one process per service and attach a volume to one service only, so web and worker could not share a filesystem. `start.mjs` migrates, then runs both in one container and exits if either stops so the platform restarts them together; blobs go to S3-compatible storage. Larger deployments still run web and worker separately from the same image.

## D20. Contact details are configured, never inferred
The site used to derive `support@<host>`. On a hosting provider's domain that address cannot exist, and on a custom domain it might not. A contact address that bounces is a false claim on a trust product, so unset now means not shown.

## D21. Secrets never travel in URLs; results that confer trust are signed
Found in QA: tokens and share links were in redirect URLs, and `/verify` results were plain base64 that anyone could forge into a "valid" page. Now secrets travel sealed and user-bound, verification results are server-signed, and a self-signed dossier that claims platform attestation is shown for what it is.

## D22. Readiness means storage works too
`/api/ready` round-trips an encrypted blob (cached for a minute), because a deployment whose bucket rejects writes looks healthy until the first customer uploads code. It was added when the documentation of a trial deployment's S3-compatible store showed it does not support server-side encryption, while the uploader always requested it; the header is now configurable with `S3_SERVER_SIDE_ENCRYPTION`, and the check proves the setting on every deploy.
