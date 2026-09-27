# Roadmap

Ordered by what most reduces the risk that this is the wrong company, not by what is most fun to build. The assumptions A1–A3 are in MARKET.md; the kill criteria are in WHY_NOT.md.

## Now: prove someone pays (weeks 1–6)

| Work | Tests | Done when |
|---|---|---|
| 20 seller conversations through M&A advisors and startup counsel; pre-sell Readiness at $1,500 | A1 | 5 paid, or a clear reason why not |
| 10 acquirer conversations (aggregators, search funds, micro-PE): deals per year, spend per deal, whether a self-attested, reproducible dossier changes their process | A2 | 3 willing to send the token-and-push request to a live target |
| Publish `@acquicode/cli` to npm, with a GitHub Action wrapper | Distribution | `npx @acquicode/cli scan` works. The landing page doesn't claim it until then. |
| One law-firm design partner using share links in a live deal | Channel | Their questions come from the dossier, not a blank checklist |

## Next: close the gaps the kill tests exposed (weeks 6–16)

1. **Buyer request workflow in the app.** Today an acquirer hands a target a write-only token by hand. Next: "request a dossier" creates the token, the instructions and an inbox, and tracks status per target.
2. **Organisation-wide view across repositories.** The engine already merges contributors and AI evidence across repositories (the corporate "400 repos in a week" scenario); the web app still shows one repository per dossier. Next: multi-repository scans and a cross-repository contributor register in the app.
3. **Material-change notifications.** Custody records changes on a timeline; nothing notifies anyone yet. Email and webhooks are next.
4. **Signing-key history.** Publish every platform key with validity periods (`/.well-known/acquicode-keys.json`), so dossiers signed before a rotation stay verifiable without out-of-band steps.
5. **REPRODUCED attestation.** A neutral runner (ours or a buyer's) re-runs the analysis on the same commits and countersigns the digest. This is the strongest trust level the protocol allows.
6. **VERIFIED producers.** Signed commits checked against the forge's key registry; forge-confirmed review approvals.

## Later: enterprise and breadth

- SSO/SAML, SCIM.
- Bitbucket and Azure DevOps sources.
- A worker agent that runs in the customer's network while the UI stays hosted. For customers who cannot use hosted cloning and want more than the CLI.
- Customer-managed encryption keys.
- License-text and snippet evidence for vendored code, through an open-source matcher. Snippet matching against all open source stays out of scope unless partnered.
- Data-room export (Datasite, Intralinks) and R&W underwriting packs.
- External penetration test; SOC 2 Type I.

## Not planned

- An AI-written percentage from detection.
- A general-purpose security dashboard.
- LLM-written dossier prose.
