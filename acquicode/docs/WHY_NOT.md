# Why not

The strongest reasons AcquiCode could fail, the conditions under which we would stop, and the directions we rejected.

## 0. The strongest reasons the company could fail

Ranked by how likely each is to kill the company, not by how comfortable it is to discuss.

1. **The buyer is episodic.**
   - A company sells itself once. Readiness is a one-time purchase at the moment the customer is most distracted, and it is usually bought on an advisor's recommendation.
   - If Custody and Acquirer don't retain, revenue is a treadmill of new logos whose acquisition cost resets every time.
2. **Nobody has paid yet.**
   - Every price in PRODUCT.md is an anchor, not a result.
   - Willingness to pay (A1), buyer acceptance (A2) and recurrence (A3) are all untested.
   - The software is further along than the evidence that anyone wants it.
3. **Black Duck already sells to sellers.**
   - It has the brand M&A lawyers trust, snippet matching we lack, and a page that now names both sellers and AI.
   - If it ships a cheaper self-serve tier, our price advantage becomes a feature comparison we lose on depth.
4. **Seller-produced evidence may never be trusted.**
   - Reproducibility is a strong argument to engineers. Deal lawyers may still prefer a human auditor's letter.
   - If buyers won't accept SELF_ATTESTED or even PLATFORM_ATTESTED dossiers, the two-sided loop, and with it the moat, never forms.
5. **The AI section may usually say "unknown".**
   - Most repositories record little AI attribution today, and what is recorded can be wrong (the VS Code episode).
   - If real customers' dossiers are mostly unknowns, the headline differentiator shrinks to ownership, licenses and secrets, where incumbents are strong.
6. **Distribution runs through gatekeepers.**
   - M&A advisors, lawyers and acquirers decide what sellers buy, and they are relationship businesses.
   - A small team without that network may spend its runway earning introductions.
7. **The trust surface is unforgiving.**
   - A single cross-tenant leak, or a dossier that over-claims in a live deal, ends the company.
   - This build found and fixed several serious flaws in adversarial QA; the next one may be found by a customer.

## 1. Directions rejected

| Direction | Why not |
|---|---|
| **"X% of this code was written by AI"** (the original headline) | Detection of AI-written code is an open research problem. A percentage built on it is a guess presented as a fact, and in a transaction document it is a liability. Sema already sells detection. We report evidence by class and call the rest unknown. The second research loop strengthened this: even *attribution* written by tools is noisy (VS Code added Copilot co-author trailers to commits with no AI involvement), so raw trailer counts are unsafe too. |
| **Generic code-quality or security dashboard** | Snyk, GitHub, Sonar and Semgrep own it and are cheap per developer. Nobody pays twice. We keep only findings that change a transaction. |
| **LLM-generated narrative or "AI insights"** | Breaks reproducibility, the verification protocol that makes seller-run dossiers trustworthy. It sends customer code to a model vendor, adds a prompt-injection surface, and is not what buyers pay for. |
| **Services-first (human-led audits)** | Black Duck, CAST and the consultancies already do this with brand and relationships we don't have. Margins and scale work against a small team. We may partner with auditors; we won't become one. |
| **Series A founders as the ICP** | Code diligence is rare at that stage (ASSUMPTION); weak pain. Demoted. |
| **"Regulation requires this" positioning** | False today: EU AI Act Article 50 guidelines treat source code as outside the marking duties. We will not sell fear of a rule that doesn't apply. |
| **Upload-by-default for enterprise** | Targets rarely hand code to a buyer directly, and security teams block uploads. Local-first with signed, reproducible output is the answer; hosted scanning is a convenience for self-serve sellers. |
| **Per-developer pricing** | The seller's headcount is irrelevant to the value of a transaction document. |
| **Open-sourcing everything now** | The engine's reproducibility claim is strongest if anyone can run it, so an open analyzer is likely right eventually. But before product–market fit, the hosted workflow, the buyer network and the snapshot history are the only defensible parts. Decide after the first 50 paying customers. |

## 2. Kill criteria

We stop, or pivot, if any of these holds after the validation phase in ROADMAP.md:

1. **Sellers won't pay before a buyer asks** (A1 fails): fewer than 3 of 20 qualified sellers pre-pay. The product then becomes buyer-led and sales-heavy, a different company that needs different founders and funding.
2. **Acquirers won't accept a seller-produced dossier**, even reproducible and signed. If no acquirer changes their process after seeing one, the two-sided loop never starts, and we are a cheaper, weaker Black Duck.
3. **A platform ships a neutral, cross-forge, signed diligence export.** If GitHub or GitLab offered what the dossier does for any repository, including other forges' evidence, the self-serve wedge would collapse.
4. **Deals don't move on it.** If counsel and buyers read the dossier but it changes no price, escrow, representation or timeline in 10 observed transactions, it's a nice-to-have.
5. **The evidence doesn't exist.** If, in real customer repositories, nearly all AI use is unrecorded (no trailers, notes or traces), the AI section is mostly "unknown" and the product reduces to OSS and ownership diligence, where Black Duck and FOSSA are strong. We'd reposition around ownership and chain of title, or stop.

## 3. What would make us double down

- Two or more acquirers asking targets for an AcquiCode dossier by name.
- An R&W insurer or broker accepting it as part of underwriting. Law firms already predict AI exclusions when "the diligence record is incomplete" (Fasken, August 2026).
- Continuous-mode retention above 50% at six months among sellers who close a deal.
