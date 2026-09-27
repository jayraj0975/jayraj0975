# Founder report

Date: 27 September 2026. Labels follow MARKET.md: **FACT** (sourced), **OBSERVATION** (seen directly), **ASSUMPTION** (untested belief), **SCENARIO** (explicit if-then arithmetic). There are no forecasts here.

## Final decision gate (§27)

| # | Question | Answer | What we did about it |
|---|---|---|---|
| 1 | Is the problem painful enough? | **Yes for sellers in a live process; unproven that they pay before a buyer asks.** An acquirer says unexplained AI use cuts valuations 15–30% (FACT, the acquirer's claim, method not given). Black Duck finds license conflicts in 94% of audited deals (FACT). Willingness to pay is ASSUMPTION A1. | Focused on the seller at the moment of maximum pain. Series A was killed as the ICP. |
| 2 | Does someone already solve it well? | **Buy-side, human-led: yes** (Black Duck, CAST, consultancies; weeks, $5k–$30k). **Self-serve, evidence-graded, reproducible, seller-run: no one we found** (OBSERVATION). The second loop found Black Duck also markets to sellers. | Narrowed our claim to where incumbents are structurally weak (D11): self-serve speed and price, continuous custody, a verifiable artifact, graded AI evidence. |
| 3 | Can incumbents trivially copy it? | **The scanners: yes. The protocol and the data: not trivially.** Black Duck could build a comparable engine in a quarter or two. It cannot backfill a customer's signed snapshot history, or buyers' habit of accepting a format. | Designed for what can't be copied: continuous custody (history accrues from day one), token-and-push buyer requests (two-sided), reproducibility (hard for detection-based products). |
| 4 | Does the product have a meaningful moat? | **Not today.** Every moat candidate is zero on day one: contemporaneous history, two-sided adoption, the outcome corpus. | Accepted as the central risk (WHY_NOT.md §0). The product is built so that each customer adds to all three. Kill criterion 2 tests whether the network can start at all. |
| 5 | Can it acquire customers without enormous sales overhead? | **Sellers: plausibly** (GitHub sign-in, a free CLI, a public sample, share links that expose buyers and counsel to the product). **Enterprise: no**, it will need sales. | Enterprise is last in the roadmap. First distribution test: advisors and startup counsel (ROADMAP.md "Now"). |
| 6 | Is there recurring revenue? | **Designed, unproven.** Custody and Acquirer are monthly; Readiness is one-time. ASSUMPTION A3. | Custody is sold on the continuity a buyer values (a signed history), not on alerts we don't send yet. |
| 7 | Can most operations be automated? | **Yes.** Deterministic analysis, a self-serve workflow, a Postgres-backed queue. Humans are needed only for enterprise onboarding and sales. | Built that way (OBSERVATION: the hosted scan path has no human step). |
| 8 | Can a tiny team maintain it? | **Yes, with one caveat.** One TypeScript codebase, one database, one image, 144 tests, green CI. The caveat: parsers and AI attribution formats churn, and the VS Code trailer episode shows the rules need continuous research. | Rules are versioned and every evidence source is graded, so a noisy new format degrades to "corroborating", not to wrong answers. |
| 9 | Can it expand into a larger category? | **Plausibly** (ASSUMPTION): software chain-of-title for M&A → R&W underwriting input → vendor due diligence when enterprises buy from AI-built startups → SBOM and vulnerability duties under the EU CRA (SBOM obligations from December 2027, FACT) → post-merger integration. | Kept the engine general (multi-repository, standard formats), not M&A-specific. |
| 10 | Is it meaningfully different from Forge? | **Unverified.** The only "Forge" in the account is `jayraj0975/demand-forge`. Access to read it was not granted in this session, so no comparison was made. By name it appears to address demand generation; AcquiCode is a technical-diligence product with a different buyer, workflow and data. **Treat this as an open question for the founder to confirm.** | Nothing in AcquiCode depends on or overlaps with that repository. |

**Verdict: proceed, as a validation-stage company.**

- No gate answer is a clean "no" except the moat (#4), and no day-zero company passes that one. What matters is whether the mechanism to earn it is built into the product, and it is.
- #10 is unanswered for want of access, not because of a known conflict.
- The next step is not more code. It is the six-week validation plan in ROADMAP.md, with the kill criteria in WHY_NOT.md applied honestly.

## Founder report (§30)

**Name:** AcquiCode.

**Category:** evidence-graded technical diligence for AI-built software.

**One sentence:** know what a buyer will find in your code before they look, and hand them a dossier they can verify without seeing the code.

**Problem.** When software changes hands, buyers now ask:

- which code AI tools produced, and was it reviewed by someone who understood it;
- who actually wrote it, and does the company own it;
- which licenses and exposures come with it.

Sellers can't answer from memory, and the evidence that exists (commit metadata, attribution notes, agent traces, review records) decays or gets squashed. Today the answers come from 2–4 week human audits costing $5k–$30k (FACT, vendor marketing), which the buyer usually controls, or from a seller's unverifiable self-description.

**ICP.** Software companies preparing for an acquisition or a late-stage raise (roughly 6–18 months out), with meaningful AI-assisted development, on GitHub or GitLab. Buyer is the CEO, CTO or CFO, usually prompted by an M&A advisor or counsel. Second ICP: small and mid-size acquirers (aggregators, search funds, micro-PE) who run more deals than they can fully audit.

**Wedge.** A $1,500 self-serve Readiness dossier the seller runs before the buyer's diligence. It is platform-attested, shareable with the buyer and counsel, and re-runnable for 90 days while issues are fixed.

**Product (built, OBSERVATION).**

- A deterministic evidence engine: git history, 13 package managers, licenses, secrets, CI and supply chain, and AI attribution from git-ai notes, Agent Trace, trailers and blame, with every claim carrying a provenance state.
- Twelve invariants that refuse to emit an over-claiming dossier.
- A CLI (scan, sign, verify-by-reproduction, diff, push).
- A hosted app: GitHub App, GitLab, ZIP; worker; signed dossiers; share links; continuous mode; buyer token-and-push; audit trail; billing.
- PostgreSQL with forced row-level security.
- One container image, a compose stack and CI.
- 144 tests, including an end-to-end suite against the production build and replays of every attack found.

**Moat (to be earned, not claimed).**

1. Contemporaneous, signed snapshot history per customer (a chain of custody can't be backfilled).
2. Two-sided format adoption: buyers who request dossiers create sellers, and sellers who arrive with one educate buyers.
3. Reproducibility as the verification protocol, which detection-based competitors can't match.
4. An outcome corpus: which findings moved price or terms, after hundreds of deals.

All four are zero today.

**Distribution.**

- Self-serve (GitHub sign-in, a free CLI in CI, a public sample dossier).
- Share links that put the product in front of buyers and counsel in every deal.
- Buyer-initiated requests (token-and-push).
- Channel partners: M&A advisors and startup counsel, who need the facts but won't pay for software.
- Later: R&W brokers.

**Pricing** (ASSUMPTION, untested): Local free; Readiness $1,500 per dossier; Custody $490/month; Acquirer $2,500/month; Enterprise custom. Anchors: audits $5k–$30k; Sema $33/developer/month; escrow from $125/month (FACT).

**Unit economics assumptions.**

- **Compute.** In our test suites, analysis of a synthetic 3,000-file, 1,200-commit repository takes about 1.5 s. A hosted upload-to-signed-dossier run through the worker takes about 1 s (OBSERVATION, CI logs). Both are small repositories. We have not measured large real-world monorepos, and clone time will dominate there. ASSUMPTION: under $1 of compute per hosted scan even for large repositories, so gross margin at $1,500 is above 90% before support.
- **Acquisition cost.** Unknown. SCENARIO: if an advisor channel costs $300–$600 per closed Readiness customer, a one-time sale pays back immediately. Lifetime value depends entirely on Custody conversion (A3). At a 20% conversion to Custody for 12 months, LTV is about $1,500 + 0.2 × 12 × $490 ≈ $2,680 per seller.
- **Support.** The real cost is humans answering "what does this finding mean for my deal". The dossier's routed questions exist to keep that low. Unmeasured.

**Expansion.** Seller readiness → continuous custody through the process and post-close → acquirer workflows across targets → R&W underwriting input → vendor due diligence (enterprises buying software from AI-built startups) → SBOM and vulnerability-handling evidence for EU CRA duties.

**Competitors.** Black Duck (the real threat, human-led M&A audits, now also marketing to sellers and covering AI), Sema (codebase scans, GenAI detection), CAST Highlight, FOSSA, Snyk and GitHub/GitLab (scanners), tech-DD consultancies, escrow providers (partners), attribution capture tools (git-ai, Agent Trace; complements we ingest). Full matrix: COMPETITORS.md.

**Competitive gaps we exploit.**

- No one offers a *self-serve*, *seller-run*, *signed and reproducible* diligence dossier.
- No one *grades* AI attribution: detection vendors guess, trailer counters over-trust.
- No one gives counsel a contributor register matched to IP agreements automatically.
- No one offers continuous custody between diligence events.

**Risks.** See the next section and WHY_NOT.md. The top three: episodic buyer; unproven willingness to pay; Black Duck moving down-market.

**Why now.**

- The human-authorship rule settled in the US (*Thaler*, cert denied March 2026, FACT).
- Machine-readable AI attribution exists for the first time (Agent Trace, git-ai, agent trailers, FACT), but is noisy and decays, so capture has to be contemporaneous.
- Acquirers now ask about AI share and review (FACT).
- Law firms expect insurers to narrow AI coverage where the diligence record is incomplete (FACT, a law firm's view).
- Not regulation: the EU AI Act excludes source code from Article 50(2) marking (FACT). We don't sell fear of a rule that doesn't apply.

**Why this team can build it.** The evidence is the build itself:

- a working, tested engine and product produced in one autonomous cycle;
- two research loops that changed the product (killing AI-percentage detection; grading editor-inserted trailers);
- adversarial QA that found and fixed real cross-tenant, SSRF and trust flaws before any customer did.

What the team has *not* shown is the M&A network that distribution depends on. That has to be hired or partnered.

**What was killed.**

- The "X% written by AI" headline and detection generally.
- Series A founders as the ICP.
- A security dashboard.
- Any LLM in the pipeline.
- Upload-by-default for enterprise.
- "Regulation requires this" positioning.
- The brief's $499 snapshot price.
- Per-developer pricing.
- Plan features that didn't exist (alerts, portfolio view, SSO, self-hosted workers), removed from the copy until built.

**What changed during autonomous research.**

1. AI percentage → evidence-graded attribution with an explicit "unknown".
2. Buyer-first → seller-first, with a buyer request loop.
3. Upload → local-first CLI plus reproducibility as the trust mechanism.
4. The contributor register and human-review evidence were added.
5. *Second loop:* editor-inserted AI trailers downgraded to corroborating (AI-013, invariants I11 and I12).
6. *Second loop:* the Black Duck positioning narrowed to self-serve, custody and verifiability.
7. *Second loop:* R&W insurance added as a channel to test, not a claim.

**Why the final architecture was chosen.**

- **Deterministic engine, no LLM.** This makes reproduction-based verification possible and keeps code away from model vendors.
- **One engine for CLI and hosted.** Local and hosted dossiers are identical.
- **PostgreSQL** as data store, queue, rate limiter and tenant-isolation mechanism (forced RLS). A tiny team runs one stateful service, and isolation holds even if application code forgets a filter.
- **Application-level encryption** with key ids and a re-encryption tool.
- **Worker plus isolated analysis child.** Resource limits, and no secrets in the process that reads hostile repositories.
- **Standard formats** (DSSE/in-toto, CycloneDX, Agent Trace, git-ai), so buyers need nothing from us to consume the output.
- Details: ARCHITECTURE.md.

**What remains uncertain.**

- Whether sellers pay before a buyer asks (A1).
- Whether acquirers accept seller-produced, reproducible dossiers (A2).
- Whether monitoring retains (A3).
- How often real repositories contain AI attribution worth grading.
- How dossiers perform on very large real monorepos.
- Whether Black Duck ships a self-serve tier.
- Whether prices hold.
- How AcquiCode relates to "Forge" (gate #10).
- Security: no external penetration test yet.

## WHY THIS COULD STILL FAIL (§31)

- **It is a product in search of its first invoice.** Everything real here is software. None of it is revenue. The ratio of engineering certainty to market certainty is badly inverted, and the next six weeks must be spent on sales conversations, not features.
- **The buyer buys once.**
  - A company is sold once.
  - Even a great Readiness product faces a customer who churns by design at the moment of success.
  - The recurring plans assume sellers and acquirers value continuity enough to pay monthly. Nothing supports that yet.
- **The market may be smaller than it feels.**
  - We refused to invent a TAM, because the number of transactions where code is actually diligenced is not public.
  - SCENARIO S1 shows that even with thousands of such transactions, one-time dossiers alone are not venture scale.
  - Without expansion into custody, underwriting or vendor diligence, this is a good small business at best.
- **The incumbent is awake.** Black Duck already names sellers and AI on its M&A page, holds the lawyers' trust, and has snippet matching we don't. A cheaper self-serve tier from them would turn our advantage into a price war against a company with a knowledge base we can't match.
- **Trust may not transfer.**
  - "Anyone can reproduce the digest" persuades engineers.
  - A deal lawyer on a deadline may still want a letter from a firm with insurance.
  - If buyers won't accept seller-produced dossiers, there is no two-sided network, and therefore no moat.
- **The evidence may be thin, and tools make it noisier.**
  - Most AI-assisted code today leaves no reliable record.
  - Where records exist, vendors can corrupt them: VS Code stamped Copilot on commits with no AI involvement.
  - Our honest answer is often "unknown". Honest is right, but "unknown" is a hard thing to sell as the headline.
- **One mistake is fatal.** We sell certainty about uncertainty during the most sensitive moment in a company's life. A cross-tenant leak, a missed live credential, or a dossier that over-claims in a live deal would end us. Adversarial QA found an installation-hijack path and a managed-database isolation failure before launch; that is reassuring and alarming in equal measure.
- **Distribution depends on people we don't know yet.** Advisors and counsel gate what sellers buy. Without a founder or partner inside that network, the self-serve funnel will be slow, and the runway may end before the network effect begins.

If the six-week validation produces fewer than three paying sellers and no acquirer willing to request a dossier, the correct move is to stop or pivot to ownership and chain-of-title tooling for counsel, not to build more.
