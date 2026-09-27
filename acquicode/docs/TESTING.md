# Testing

```sh
cd acquicode
pnpm install
pnpm run build          # engine, CLI, web (the e2e suite runs the production build)
pnpm run typecheck
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

**144 tests in 8 files.** All pass locally and in CI (`.github/workflows/acquicode.yml`). The database-backed suites create their own databases and roles, and skip with a printed reason only if PostgreSQL or the build is missing. CI provides both, so nothing is skipped there.

| Suite | Tests | What it proves |
|---|---|---|
| `packages/engine/test/unit.test.ts` | 42 | State lattice (conjunction never stronger than its weakest input; agreement never manufactures certainty). Canonical JSON and ids. Git trailer and commit parsing. AI identity and signal matching, including editor-inserted trailers. git-ai and Agent Trace parsing. SPDX expressions and license-text fingerprints. Secret rules and redaction. CVSS 3.x. Zip safety. Declarations parsing. |
| `packages/engine/test/ecosystems.test.ts` | 12 | Manifests and lockfiles across npm, Yarn (v1 and Berry), pnpm, pip, Poetry, uv, PDM, Pipenv, Go, Cargo, Bundler, Composer and Maven; private-package detection. |
| `packages/engine/test/meridian.test.ts` | 13 | The synthetic company end to end (§1): the exact readiness, rules, AI counts, tools, states, suppressions and unknowns. No secret leaks into any output. A rebuilt checkout gives the same digest. CycloneDX, signing and tamper detection, diffs, enrichment replay, HTML sections. |
| `packages/engine/test/adversarial.test.ts` | 26 | Hostile inputs and the uncertainty-to-certainty release blocker (§2). |
| `packages/cli/test/cli.test.ts` | 6 | scan/sign/gate/artifacts, verify plus reproduce, tamper detection, diff, clear errors. |
| `apps/web/test/unit.test.ts` | 20 | Encryption (tamper, context binding, rotation, blob swapping). Signed OAuth state. Stripe and GitHub signatures. SSRF guards (address classes, encoded IPs, internal names, resolution, pinning). Trusted-proxy IP selection. Cross-origin refusal. Form error redirects. API CSP. Log redaction. Production config refusals. |
| `apps/web/test/db.test.ts` | 9 | Tenant isolation in PostgreSQL with a **non-superuser owner** (as on managed databases) (§3). |
| `apps/web/test/e2e.test.ts` | 16 | The standalone production build plus the worker plus a fresh database, driven over HTTP, with a stand-in for GitHub (§4). |

## 1. Meridian Systems: the messy synthetic company

`packages/engine/src/demo/meridian.ts` builds a deterministic git repository that looks like a real 2023–2025 startup:

- **People:** three founders and employees, a contractor on Gmail, an agency, a GitHub noreply user, the Copilot coding agent, and Dependabot.
- **AI evidence:**
  - Claude Code trailers;
  - a git-ai note;
  - Agent Trace records: one valid, one naming a revision that doesn't exist, one with out-of-range lines, and one that contradicts git-ai;
  - Cursor, aider and ChatGPT signals.
- **Problems a buyer would find:**
  - a secret committed and later removed (still in history);
  - live-format keys in production configuration;
  - AGPL and GPL dependencies in on-prem software;
  - lockfile drift;
  - vendored code without a license;
  - a committed model;
  - a binary exporter;
  - an unpinned CI action;
  - `curl | sh`;
  - a `latest` base image.
- **Company declarations:** an IP register with a gap and a suppression.

The same fixture powers the public sample dossier (`/sample`).

## 2. Adversarial cases

The brief's release blocker is "can the system accidentally turn uncertainty into certainty?" Each case below is a test that fails if it does.

| Case | Guarantee |
|---|---|
| Hand-typed AI trailer | Recorded as self-declared, never VERIFIED. |
| Traces naming missing commits, files or lines | UNVERIFIABLE; carry no weight. |
| Traces supplied out of band | USER_ASSERTED. |
| "No AI" declaration contradicted by evidence | CONFLICTING, and the question needs attention. |
| **Editor-inserted Copilot trailer** (VS Code `git.addAICoAuthor`) | Corroborating only; never direct attribution; never a contradiction on its own. |
| File with no evidence | UNKNOWN, never "human". |
| Rename after AI authorship | Attribution follows the lines through blame. |
| Shallow history | Recorded as incomplete evidence. |
| Inference-only signals | Can never block a transaction. |
| Clean, fully declared, enriched repository | Can reach READY. READY is achievable, not a vanity state. |
| Same commit, different checkout path | Same digest. |

Hostile content is covered too: escaped names and extracts; instructions planted in repository text; symlinks out of the tree; binary-only content; malformed manifests, lockfiles and declarations; uncommitted work; zip-slip and `.git` payloads; zip bombs; corrupt archives; a 3,000-file, 1,200-commit monorepo within limits; contributor merging across repositories; and an empty repository.

## 3. Database isolation (`db.test.ts`)

Runs migrations as a role that owns the database but is **not a superuser**, then queries as the unprivileged app role:

- Migrations are idempotent. They refuse an app role that is BYPASSRLS, a superuser, or the owner.
- Without an organisation context, every tenant table shows zero rows.
- One organisation sees only its own rows. Cross-tenant UPDATE and DELETE affect nothing, and cross-tenant INSERT is rejected by the policy.
- FORCE RLS binds the table owner too.
- Pre-authentication definer lookups work with a non-superuser owner (share links, API tokens, repositories, the scheduler, invitations by GitHub id).
- The audit trail is append-only, even for the owner.
- Definer functions are not executable by PUBLIC.
- The app role cannot create objects.

## 4. End to end (`e2e.test.ts`)

Starts `.next/standalone/.../server.js` and `dist-node/worker/index.mjs` with production settings against a freshly migrated database, and a local stand-in for github.com and api.github.com. Then:

1. **Public pages.** Served with a nonce CSP and frame denial. The sample dossier renders.
2. **Signed-out and cross-origin.** Signed-out users are redirected to sign in; cross-origin form posts are refused.
3. **Upload to signed dossier.**
   - An uploaded archive is analysed by the worker: BLOCKED (a provider-format key), PLATFORM_ATTESTED, and the key never appears on the page.
   - The upload and work directory are gone afterwards.
   - The stored body is encrypted (`ACQ1`, no plaintext).
   - Every export downloads, with a deny-all CSP on JSON and a sandbox on HTML.
   - The platform signature verifies, and a tampered dossier fails.
4. **Isolation and sharing.**
   - Another organisation gets 404 for the dossier, the downloads and the delete.
   - Share links count views, and revocation stops them. A forged token shows "not available".
5. **Declarations and CLI push.**
   - Declarations are versioned; invalid ones are rejected.
   - CLI push with an API token: a signed dossier is accepted as SELF_ATTESTED, a forged one gets 422, and a bad token gets 401.
6. **Webhooks.** Unsigned webhooks are rejected, signed ones accepted.
7. **GitHub App connection** (with the stand-in), each attack replayed:
   - another organisation's admin replays an installation id;
   - authorising as a different GitHub account;
   - completing another session's state;
   - the legitimate path;
   - binding an installation already owned by another organisation.
8. **Invitations.** Someone who now holds an invited username cannot join; the invited GitHub account can.
9. **Audit trail.** Every expected action is recorded.
10. **Key rotation.** Credentials and dossiers are re-encrypted, readable with the new key alone, and a second run is idempotent.
11. **Repository deletion.** Rows and encrypted blobs are removed.

## 5. What is not tested (yet)

- A real GitHub App, real GitLab, and real Stripe accounts. They are exercised through stand-ins and signature tests only.
- S3 storage (the filesystem driver is exercised; S3 shares the encryption code).
- Load: many concurrent workers, very large organisations.
- An external penetration test.
