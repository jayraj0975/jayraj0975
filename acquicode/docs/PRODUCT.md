# Product

## 1. What it is

**AcquiCode** produces an evidence-graded technical diligence dossier for AI-built software: what the code contains, who wrote it, what AI tools were involved and how well that is recorded, which licenses and exposures a buyer will find, and exactly what cannot be established. It runs where the code lives, and its output is signed and reproducible, so a buyer can trust a dossier the seller produced.

**Category:** evidence-graded technical diligence.

**One sentence:** know what a buyer will find in your code before they look, and hand them a dossier they can verify without seeing the code.

## 2. Who it is for

| Customer | Job to be done | How they use AcquiCode |
|---|---|---|
| **Seller** preparing for an acquisition (primary ICP) | Avoid surprises in buyer diligence that cut the price or kill the deal | Connect GitHub/GitLab or run the CLI → fix what's fixable → declare what isn't → share a platform-attested dossier with the buyer and counsel. |
| **Acquirer** (aggregators, search funds, PE, corporate development) | Diligence more targets than they can afford full audits for, without taking custody of code | Give each target a write-only token → the target runs the CLI and pushes a signed dossier → verify it, read the questions, route them. |
| **Counsel** on either side (channel, not buyer) | Facts for IP schedules and disclosure: contributors vs. agreements, licenses, AI tools and their terms | Read the "Questions for counsel" and the contributor register through a share link. |
| **CTO inheriting an AI-built codebase** (secondary) | Understand what they now own | Same dossier; maintainability and reproducibility sections. |

Demoted after the kill tests: Series A founders (rare code diligence at that stage) and general security teams (served by existing scanners).

## 3. Flows

### Sell-side readiness (self-serve)

1. Sign in with GitHub. A personal workspace is created.
2. **Add source:**
   - install the GitHub App and choose repositories;
   - or connect a GitLab project with a read-only project access token;
   - or upload a ZIP (history-dependent sections are then reported as unknown);
   - or run the CLI and push.
3. **Scan.** The dossier appears with **READY / REVIEW / BLOCKED**, then *why* (questions), then *evidence*, then *unknowns*.
4. **Resolve:**
   - fix exposures (rotate the key, pin the action);
   - add declarations (`acquicode.yml`: distribution model, AI tools and their terms, origin statements, suppressions with reasons);
   - upload the IP register;
   - re-scan.
5. **Share.** Create a read-only link for the buyer or counsel. Views are counted. Revoke at any time.
6. *(Custody plan)* Turn on continuous mode. Every push is re-analysed and material changes appear on the repository timeline.

### Buyer request (no code changes hands)

1. The acquirer creates a write-only API token in Settings and sends it to the target.
2. The target runs `acquicode scan --sign-key … && acquicode push …` in their CI or on a laptop.
3. The dossier lands in the acquirer's workspace as SELF_ATTESTED, with the signer's key id and the result of a signature check.
4. If the acquirer later gets code access (or a clean-room reviewer does), `acquicode verify --reproduce` proves the dossier matches the code.

### Anyone: verify

`/verify` checks a dossier and envelope: signature validity, digest match, attestation level, key id. No account is needed.

## 4. The dossier

The fifteen sections of the brief, as rendered in the HTML export (the app shows the same content in tabs):

1. Executive summary: readiness, headline, top findings, scope statement.
   - 1a. Changes since the previous snapshot (when one exists).
2. Repository inventory.
3. Software ownership evidence: contributors, identities, IP register match.
4. AI development evidence: by evidence class, tools, review evidence, declarations vs. evidence.
5. Dependency & license analysis.
6. Security exposure.
7. Build & reproducibility.
8. Maintainability, including dependence on AI providers.
9. Material unknowns.
10. Questions for management.
11. Questions for counsel.
12. Questions for engineering.
    - 12a. Diligence question detail.
13. Evidence index.
14–15. Machine-readable export & signed manifest: digest, analyzer, rules, coverage, attestation.

Plus machine-readable exports: dossier JSON, CycloneDX 1.6 SBOM, and the DSSE envelope.

## 5. UX principles

- **READY/REVIEW/BLOCKED → WHY → EVIDENCE → UNKNOWN**, in that order, every time.
- **Every level carries its scope.** It measures how completely evidence answers the questions, not whether the software is good or safe.
- **Uncertainty is visible.** Every claim shows its provenance state. "No evidence" says "unknown", never "human".
- **No gimmicks.** No scores out of 100, no AI percentage, no charts that imply precision the evidence doesn't have, and no LLM prose.
- **Nothing fake.** Features that aren't configured on a deployment (GitHub App, Stripe, signing key) say "not configured" rather than pretending.
- **Plain HTML forms.** It works without JavaScript and prints cleanly.

## 6. Pricing

| Plan | Price | For | Includes |
|---|---|---|---|
| Local | $0 | Engineers and CI | CLI and CI analysis, full dossier and SBOM, self-signed attestations, one hosted repository |
| Readiness | $1,500 per dossier (90 days) | Sellers before a process | Up to 10 repositories, platform-attested dossiers, share links, re-scans for 90 days, change reports |
| Custody | $490 per month | Within two years of a raise or exit; post-close | Up to 25 repositories, continuous monitoring on push, signed snapshot history, change timeline, share links |
| Acquirer | $2,500 per month | Aggregators, search funds, PE | Up to 60 repositories, signed dossiers pushed by targets with write-only tokens, verification, share links, change reports |
| Enterprise | Custom | Large targets; teams that must run everything themselves | The whole stack in their environment, custom limits and retention, dossier upload API, direct support |

Rationale and anchors: DECISIONS.md D9. These prices are **untested**. The first 20 sales conversations exist to break them.

## 7. Deliberately not in the product

- **AI-written percentage, or detection of AI-written code.** Unreliable, and a liability in a transaction document.
- **A general security dashboard.** Snyk and GitHub own it. We keep only transaction-material findings.
- **Legal conclusions.** We generate questions for counsel instead.
- **A language model** anywhere in the analysis or the narrative.
- **Snippet matching** against all open-source code. Not built; stated in the dossier.
