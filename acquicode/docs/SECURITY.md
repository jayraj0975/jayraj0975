# Security

Source code is the most sensitive thing a company owns, and a diligence tool sees it at the worst possible moment: during a transaction. This document says what AcquiCode does with code and data, how each control is implemented, and which test proves it. THREAT_MODEL.md covers attackers and residual risk.

Reporting a vulnerability: email security@acquicode.com with details and a way to reproduce. We acknowledge within two business days and do not pursue good-faith research.

## 1. What leaves the customer's environment

| Mode | Source code | What we store |
|---|---|---|
| **CLI** (`acquicode scan`) | Never leaves the machine. | Nothing, unless the user runs `push`, which uploads the dossier (paths, hashes, metadata, findings; no file contents beyond short structured extracts, which `--omit-extracts` removes). |
| **Hosted, GitHub/GitLab** | Cloned by the worker into a per-scan temporary directory with a short-lived read-only token, analysed, then deleted in a `finally` block. | The dossier, encrypted, for the organisation's retention period (7–3,650 days). |
| **Hosted, ZIP upload** | Stored encrypted until the worker picks it up, then deleted after the scan whatever the outcome. | The dossier, as above. |

- **No language model.** No LLM reads customer code, and nothing is trained on it. The analysis is deterministic code (DECISIONS.md D3).
- **Optional enrichment.** When enabled, it sends only *public* package names and versions to OSV.dev, npm and PyPI. Private packages are never sent: scoped or private registries, private resolved hosts, and names containing the company's own tokens.

## 2. Controls required by the brief (§20)

| Requirement | Implementation | Proof |
|---|---|---|
| Encryption in transit | HTTPS enforced by configuration (`APP_URL` must be https in production). HSTS header. `upgrade-insecure-requests` on https. Database TLS via `DATABASE_SSL`. | `test/unit.test.ts` (config refuses http), `deploy/smoke.mjs` (HSTS) |
| Encryption at rest | AES-256-GCM in the application, before storage, with key ids. Blobs are bound to their storage key as associated data, so they cannot be swapped between tenants. GitLab tokens are bound to their repository id. | `unit.test.ts` (tamper, AAD binding), `e2e.test.ts` (stored dossier starts with `ACQ1` and contains no plaintext) |
| Minimal data retention | Clones and uploads are deleted after every scan. Dossier bodies are purged after the organisation's retention period (the digest stays as a ledger). Sessions, rate-limit rows, webhook ids and finished jobs are purged on schedule. | `e2e.test.ts` (upload deleted, work directory empty) |
| Repository deletion | Deletes the repository, scans, dossiers (including blobs), declarations, share links and change events. Organisation deletion removes everything, audit included. | `e2e.test.ts` (repository delete) |
| Token rotation | GitHub installation tokens are minted per scan (one repository, read-only, one hour) and never stored. API tokens expire (30/90/365 days) and can be revoked. Sessions expire. Encryption keys rotate (`DATA_ENCRYPTION_KEYS`, re-encryption tool). | `unit.test.ts` (key rotation), `e2e.test.ts` (re-encrypt and retire the old key) |
| Scoped OAuth | GitHub App with Contents, Metadata and Pull requests **read**. Customers pick repositories. Sign-in requests identity only. | DEPLOYMENT.md §5 |
| Secret scanning | The engine scans HEAD and history for provider-format credentials. Values are redacted in every output, and invariant I8 refuses to emit a dossier containing one. | engine `meridian.test.ts`, `adversarial.test.ts` |
| Tenant isolation | PostgreSQL FORCE ROW LEVEL SECURITY on every tenant table, keyed on a per-transaction setting. The application role cannot bypass RLS or create objects. Pre-authentication lookups go through narrow definer functions. Migrations refuse an unsafe application role. | `db.test.ts` (as a non-superuser owner), `e2e.test.ts` (another organisation gets 404) |
| Signed exports | DSSE envelope over an in-toto Statement (Ed25519). Hosted dossiers are PLATFORM_ATTESTED; CLI dossiers are SELF_ATTESTED. Anyone can verify at `/verify` or with `acquicode verify`, and `--reproduce` re-runs the analysis. | engine and CLI tests, `e2e.test.ts` (valid and tampered) |
| Audit events | Append-only table: UPDATE and DELETE are revoked from the app role, and a trigger refuses updates even from the owner. Covers sign-ins, scans, downloads, share views, declarations, tokens, members, billing and installations. | `db.test.ts`, `e2e.test.ts` |
| Access logging | Every share-link view and download is counted and audited with a trusted client IP (see TRUST_PROXY). Dossier downloads by members are audited. | `e2e.test.ts` |
| No training on customer repositories | No model in the pipeline; nothing to train. Stated in the product and the terms. | architecture |
| Safe temporary files | Per-scan `mkdtemp` directory with 0700 permissions, removed in `finally`. The askpass helper lives in it with 0700. Upload extraction guards against zip-slip, `.git` entries, symlinks, bombs, entry counts and sizes. | `adversarial.test.ts` (zip cases), `e2e.test.ts` |
| Never log raw secrets | Structured logs with a redact list. Every error message passes `sanitizeError`, which applies the engine's provider-format secret rules plus URL credentials, bearer tokens and AcquiCode's own token formats. | `unit.test.ts` (log hygiene) |
| Never expose private source code through logs | Logs carry ids, counts and durations, never file contents. The analysis child's stderr is reduced to a sanitised last line. Git stderr is sanitised. | code review, `unit.test.ts` |

## 3. Handling repositories safely

Repositories are hostile input. The engine:

- **Never executes repository code.** No builds, installs, scripts or hooks.
- **Runs git defensively.** Hooks are disabled, replace refs are ignored, `protocol.file.allow=never`, and the environment and HOME are isolated. Credentials go through an askpass script and environment variables, never argv or config.
- **Checks refs.** Refuses refs that start with `-`.
- **Doesn't follow symlinks.** It reads them as links.
- **Parses defensively.** Manifests and lockfiles are parsed with size limits, YAML with an alias limit, and nothing is evaluated.
- **Escapes everything it renders.** Every repository-derived string is escaped in HTML. Standalone exports carry a CSP that forbids scripts and are served under a sandbox CSP.
- **Runs analysis in a child process.** It has a memory cap (4 GB), a timeout, and a minimal environment (no application secrets). Timeouts kill the whole process group.

## 4. Web application

- **Sessions.** Random 32-byte tokens, stored as SHA-256 hashes, in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed and `Secure` on https).
- **CSRF.** Every mutation is a POST that checks `Origin`, or `Sec-Fetch-Site` when there is no Origin.
- **OAuth.** The OAuth state is HMAC-signed and short-lived. Sign-in state is also bound to a nonce cookie.
- **CSP.** Pages get a per-request nonce, `frame-ancestors 'none'` and `object-src 'none'`. API responses default to `default-src 'none'; sandbox`.
- **Authorisation.** Every route checks the role it needs (viewer < member < admin < owner). Admins cannot invite admins or remove owners.
- **Rate limits.** Stored in PostgreSQL. They cover sign-in, verification, share downloads, uploads, scans, GitLab connections and the API.
- **Outbound requests to customer-supplied hosts** (self-managed GitLab):
  - DNS is resolved and every address checked against private, reserved and mapped ranges.
  - Connections are pinned to the checked address, including `git clone` through `http.curloptResolve`.
  - No redirects are followed, and the clone URL is never taken from the remote's response.
- **Share links.** 32-byte random tokens, stored hashed, expire in 7–90 days, can be revoked, and every view is counted and audited.
- **API tokens.** Stored hashed. They can only upload dossiers; they cannot read anything. Request tokens (given to a target by a buyer) also stop working when the request is cancelled or expires.
- **Secrets shown once** (API and request tokens, share links, webhook secrets) are never put in a URL in plain text. The redirect carries a value sealed with the data key, bound to the user and valid for ten minutes, so browser history, proxies and referrers never see the secret.
- **Verification results are signed.** `/verify?r=` carries a server-signed result, so nobody can craft a link that displays "valid" for a forged dossier. A manifest that claims platform attestation is shown as self-attested unless a published platform key signed it.
- **Outbound webhooks** go only to https URLs on public addresses, checked when the endpoint is added and again at every delivery, with the connection pinned to the checked address and no redirects. Endpoint URLs and signing secrets are encrypted at rest. Payloads carry names, levels, counts and links, never code or evidence.
- **Operator setup** (`/setup`) is unlocked only with `SETUP_TOKEN` (compared as hashes in constant time, rate limited, same-origin), through a signed HttpOnly cookie. The GitHub App credentials GitHub returns are stored encrypted with the data key and bound to their row. Setup closes once an App exists.

## 5. Keys

| Key | Where | Rotation |
|---|---|---|
| Data encryption keys | `DATA_ENCRYPTION_KEYS` (environment or secret manager) | Prepend a new key, run `node dist-node/worker/reencrypt.mjs`, then remove the old key. See RUNBOOK.md. |
| Platform signing key | `PLATFORM_SIGNING_KEY` | Replace it and move the old public key to `PLATFORM_RETIRED_PUBLIC_KEYS`. Both are published at `/.well-known/acquicode-keys.json`, and `/verify` accepts either, so dossiers signed before the rotation stay verifiable (RUNBOOK.md). |
| GitHub App private key | `GITHUB_APP_PRIVATE_KEY`, or stored encrypted in `platform_secrets` when created through `/setup` | Generate a new key in GitHub, deploy it (as the variable, which takes precedence), then delete the old one there. |
| Notification endpoint secrets and URLs | encrypted in `notification_endpoints` | Remove the endpoint and add it again; covered by `reencrypt.mjs` on data-key rotation. |
| Webhook secrets | `GITHUB_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, per-repository GitLab secrets (stored hashed) | Change them at the provider and in configuration together. |

## 6. Known limitations (honest)

- **DNS-rebinding window.** The address check and the connection share one resolution for the GitLab API call and the clone. The worker's other outbound calls (GitHub, OSV, registries) go to fixed public hosts. Deploy workers with an egress policy that blocks private ranges anyway.
- **Shared blob storage.** The web process can read every tenant's encrypted blobs. Isolation between tenants is cryptographic binding plus row-level security on the index, not separate storage credentials per tenant.
- **No SSO/SAML, no customer-managed keys, no self-hosted worker agent yet.** See ROADMAP.md.
- **No independent review yet.** This codebase has not had an external penetration test. The adversarial tests are ours.
