# Threat model

Scope: the hosted product (web, worker, database, blob storage), the CLI, and the dossier format and verification protocol. SECURITY.md lists the controls; this document lists who attacks what and how.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Customer source code (in flight during a scan) | The most sensitive asset; a leak can end a transaction or a company. |
| Git credentials: installation tokens, GitLab project tokens | Give read access to customer repositories. |
| Dossiers | Describe the target's weaknesses, contributors and secrets (redacted) during a confidential process. |
| Integrity of dossiers and readiness levels | Parties rely on them in a transaction. A forged READY is the product's worst failure. |
| Tenant boundaries | A buyer and a seller may both be customers. |
| Keys: data encryption, platform signing, GitHub App | Compromise breaks confidentiality or attestation. |
| Audit trail | Evidence of who saw what. |

## 2. Actors

1. **External attacker** with no account.
2. **Authenticated user of another organisation**, including a buyer or a competitor in the same deal.
3. **Malicious insider in a customer organisation**, e.g. a viewer trying to act as an admin.
4. **Hostile repository.** Crafted history, files, manifests, symlinks, zip bombs, prompt-injection text, or forged AI attribution. Often the very company being diligenced, which has a motive to look clean.
5. **Hostile integration endpoint.** A self-managed GitLab server, or a forged webhook.
6. **Seller forging evidence** to present a better dossier to a buyer.
7. **Operator error.** A misconfigured database role, missing keys, or a proxy.

## 3. Trust boundaries

```
 browser ──https──▶ web (Next.js) ──SQL (app role, RLS)──▶ PostgreSQL ◀── worker (app role)
                      │                                                    │
                      └──encrypted blobs──▶ storage ◀──encrypted blobs─────┤
                                                                           ├─▶ git clone (GitHub / GitLab)
                                                                           ├─▶ OSV / npm / PyPI (public names only)
                                                                           └─▶ analysis child (no secrets, memory + time caps)
 CLI (customer machine) ──https + API token──▶ web: dossier only, no source code
```

## 4. Threats and mitigations

| # | Threat | Actor | Mitigation | Test |
|---|---|---|---|---|
| T1 | Read another organisation's dossiers, repositories or share links | 2 | FORCE row-level security on every tenant table. The app role cannot bypass it. Ids are checked inside the tenant transaction, and routes return 404, not 403. | `db.test.ts`, `e2e.test.ts` |
| T2 | **Bind another customer's GitHub installation** by replaying its `installation_id` on the setup URL, then scan its private repositories | 2 | The installation id is untrusted. Binding requires three things: a signed state issued to this admin's session; that the authorising GitHub account is the signed-in user; and that GitHub lists the installation for that account. Installations already bound elsewhere are refused. *Found and fixed during adversarial QA.* | `e2e.test.ts` (four attack variants) |
| T3 | **Join an organisation through a recycled GitHub username** after an invitation | 1, 2 | Invitations bind to GitHub's numeric user id at invite time. *Found and fixed during adversarial QA* (migration 003). | `e2e.test.ts`, `db.test.ts` |
| T4 | Privilege escalation inside an organisation | 3 | Role checked on every route. Admins cannot invite admins or remove owners. At least one owner always remains. | route audit in QA |
| T5 | CSRF against form posts | 1 | POST only, with an `Origin` / `Sec-Fetch-Site` check and SameSite=Lax cookies. | `unit.test.ts`, `e2e.test.ts` |
| T6 | XSS through repository content (file names, commit messages, trailers, license text) | 4 | Rendered through React (escaped) or through `esc()` in the HTML export. Page CSP with nonces. Exports carry a no-script CSP and are served sandboxed. API responses default to `default-src 'none'; sandbox`. *A proxy rule that replaced the export's sandbox CSP was found and fixed.* | engine `adversarial.test.ts`, `e2e.test.ts` |
| T7 | Prompt injection in repository text | 4 | No language model anywhere in the pipeline. Text is data. | engine `adversarial.test.ts` |
| T8 | Code execution through the repository (hooks, build scripts, git config, filters) | 4 | Nothing from the repository is executed. Git hooks are disabled, replace refs ignored, `protocol.file.allow=never`, HOME isolated. Symlinks are never followed. | engine tests |
| T9 | Resource exhaustion (zip bombs, huge monorepos, pathological history) | 4 | Zip limits on ratio, total, entries and per-entry size. File, byte and commit limits with recorded truncation. The analysis child has 4 GB and a timeout, and the process group is killed on timeout. | engine `adversarial.test.ts` |
| T10 | **SSRF through a self-managed GitLab URL.** Metadata endpoints or internal services, reached directly or through DNS | 5 | Literal and resolved addresses are checked against private, reserved and mapped ranges. The API call and the clone are pinned to the checked address. No redirects. The clone URL is built from the checked host, never taken from the API response. *Resolution-time checks, pinning and clone-URL construction were added during QA.* | `unit.test.ts` |
| T11 | Token exfiltration through a clone URL returned by a hostile GitLab | 5 | Same as T10: the clone URL is never taken from the response. | code |
| T12 | Forged webhooks: trigger scans, alter installations | 1 | HMAC verification for GitHub and Stripe, with a replay window for Stripe. GitLab uses a per-repository secret stored hashed. Deliveries are de-duplicated. Unsigned or unknown deliveries are rejected. | `e2e.test.ts`, `unit.test.ts` |
| T13 | Spoofed client IPs in the audit log or to evade rate limits | 1 | `X-Forwarded-For` is ignored unless `TRUST_PROXY` says how many proxies to trust; then the entry that proxy added is used, not the client-controlled leftmost one. | `unit.test.ts` |
| T14 | **Seller forges AI attribution** to look human-written, or forges human declarations | 6 | Absence of evidence is UNKNOWN, never "human". Declarations are USER_ASSERTED. Traces supplied out of band, or written long after the fact, are capped at USER_ASSERTED. Records are checked against the repository (UNVERIFIABLE if the commit, file or lines don't exist). Disagreements are CONFLICTING. Contradicted declarations raise AI-002. | engine `adversarial.test.ts`, `meridian.test.ts` |
| T15 | **Tool-inserted attribution presented as authorship.** E.g. VS Code's `Co-authored-by: Copilot` trailer, which some versions added with no AI involvement | 4, 6 | Editor-inserted trailers are CORROBORATING only (AI-013). Invariants I11 and I12 stop them from ever counting as DIRECT. *Found in the second research loop.* | engine `adversarial.test.ts` |
| T16 | Seller tampers with a dossier before handing it to a buyer | 6 | DSSE signature over the canonical dossier digest. Hosted runs are PLATFORM_ATTESTED; the verifier shows the attestation level. With code access, `acquicode verify --reproduce` re-runs the analysis and must produce the same digest, and recorded enrichment responses make that replayable. | engine, CLI, `e2e.test.ts` |
| T17 | Seller runs the CLI on a doctored checkout and pushes a self-signed dossier | 6 | That is exactly what SELF_ATTESTED means, and it is displayed as such. Buyers who need more require a hosted, platform-attested scan or reproduce the dossier. The protocol makes the trust level explicit; it cannot make a self-run scan trustworthy. | product design |
| T18 | Secrets leak through dossiers, logs or error messages | 4, 7 | Extracts are redacted at the evidence store. Invariant I8 refuses to emit a dossier containing a provider-format secret. Error messages are sanitised with the engine's secret rules plus URL credentials and token formats. | engine tests, `unit.test.ts` |
| T19 | Misconfigured database role silently bypasses RLS | 7 | Migrations refuse an app role that is a superuser, has BYPASSRLS, owns the schema or is a member of the owner role. Definer lookups have owner-only policies, so they also work on managed Postgres. *The managed-Postgres failure was found and fixed during QA.* | `db.test.ts` |
| T20 | Encryption key compromise or loss | 7 | Key ids in every ciphertext. Rotation and re-encryption tool. Production refuses to start without keys. The development key is public and refused in production. | `unit.test.ts`, `e2e.test.ts` |
| T21 | Share-link token leakage (forwarded email) | 2 | Links expire (7–90 days), can be revoked, and every view is counted and audited with IP. Tokens are stored hashed. Links show one dossier, read-only. | `e2e.test.ts` |
| T22 | Blob swapping between tenants in shared storage | 1, 7 | Each blob is encrypted with its storage key as associated data, so a moved blob fails to decrypt. | `unit.test.ts` |

## 5. Residual risks we accept today

- **The web process can decrypt every tenant's data.** Isolation is enforced by row-level security and per-object binding, not per-tenant keys. Customer-managed keys are on the roadmap.
- **Self-attested dossiers are only as honest as the seller's machine.** The product labels this; it does not solve it.
- **The worker needs network egress to customer forges.** An egress policy denying private ranges is a deployment requirement (DEPLOYMENT.md §7), not something the image can enforce.
- **Enrichment responses are trusted as returned.** OSV.dev and registries are authoritative for our purpose. Responses are recorded so a verifier sees exactly what was used.
- **No external penetration test yet.**
