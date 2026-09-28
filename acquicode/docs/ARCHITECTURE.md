# Architecture

## 1. Shape of the system

```
                         ┌──────────────────────────── customer machine / CI ─────────────────────────────┐
                         │  acquicode CLI ── @acquicode/engine ── git (read-only)                          │
                         │     scan → dossier.json + .html + .cdx.json + .dsse.json (self-attested)        │
                         │     push ─────────────────────────────────────── dossier only ──┐               │
                         └──────────────────────────────────────────────────────────────────┼───────────────┘
                                                                                            │ HTTPS + API token
┌───────────────────────────────────────────── hosted ─────────────────────────────────────▼───────────────┐
│  web (Next.js 16, standalone)                                                                             │
│   pages · route handlers · proxy.ts (CSP nonce) · GitHub/GitLab/Stripe webhooks · /verify · share links   │
│        │  SQL as acquicode_app (RLS)                        │ encrypted blobs                              │
│        ▼                                                    ▼                                              │
│  PostgreSQL 16  ◀── jobs (FOR UPDATE SKIP LOCKED) ──  worker ──▶ blob storage (fs volume or S3)            │
│   tenant tables with FORCE RLS                          │   clone (askpass, pinned host) ─▶ GitHub / GitLab│
│   audit_events (append-only)                            │   spawn analysis child (4 GB, timeout, no secrets)│
│   definer lookups (pre-auth)                            │   sign (platform key) · store · diff · audit      │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Three deployables, one image:**

- **web.** Next.js standalone server.
- **worker.** A self-contained Node bundle: job loop, clone, analysis, signing.
- **migrate.** A self-contained bundle.

The engine is a plain TypeScript library that both the CLI and the worker use, so a hosted dossier and a local dossier come from the same code and are byte-comparable.

## 2. The engine (`packages/engine`)

`analyze(inputs, options)` is a pure pipeline over one or more repositories:

1. **Snapshot.**
   - A `GitSource` reads a commit through `git` plumbing: `ls-tree`, `cat-file --batch`, `rev-list`, `diff-tree`, `blame`, `notes`. Git runs with hooks disabled, replace refs ignored, the file protocol off and HOME isolated.
   - A `DirectorySource` (ZIP uploads) reads files without following symlinks.
   - A precomputed keep-set enforces the byte and file budgets.
2. **Classification.** Language, source, test, docs, lockfile, manifest, vendored, generated (by name, `.gitattributes`, headers), minified, binary (by name and magic bytes), agent configuration.
3. **Analyzers** in a fixed order:
   - history (first-parent walk, pull-request propagation);
   - ownership (identity clustering, IP register);
   - dependencies (npm, Yarn, pnpm, pip, Poetry, uv, PDM, Pipenv, Go, Cargo, Bundler, Composer and Maven manifests and lockfiles; drift; private-package detection; CI and Docker supply chain);
   - secrets (HEAD plus historical blobs);
   - licenses (SPDX expressions, license-text fingerprints, dependency licenses);
   - third-party code markers;
   - maintainability;
   - AI dependency;
   - AI development evidence (signals, notes, traces, blame, reviews, declarations).
4. **Enrichment** (optional, recorded): OSV.dev advisories with a CVSS 3.x calculator, and npm/PyPI metadata. Responses are stored in the dossier so a verifier can replay them offline.
5. **Diligence.** Rules produce findings with states and materiality. Suppressions are applied, blocking is downgraded unless evidence is OBSERVED or VERIFIED, questions are evaluated, readiness is computed, and a templated summary is written. No language model.
6. **Invariants.** Twelve checks (PROVENANCE.md). A violation throws `InvariantViolation`: the dossier is never emitted.
7. **Outputs:**
   - canonical JSON with a SHA-256 digest;
   - standalone HTML (no scripts; a CSP forbids them);
   - CycloneDX 1.6 SBOM with explicit composition completeness;
   - DSSE envelope over an in-toto Statement v1 (Ed25519);
   - `diffDossiers` for "what materially changed".

**Determinism:**

- ids are content-addressed;
- every list is sorted;
- names come from the remote, not the directory;
- branch refs are normalised;
- time-relative rules use the head commit's date or a recorded `--as-of`;
- enrichment is replayable.

The test suite rebuilds the synthetic company in a fresh directory and requires an identical digest.

## 3. The hosted product (`apps/web`)

### Request path

- **CSP.** `proxy.ts` sets a per-request CSP nonce on pages. API routes set their own headers: a deny-all CSP by default, sandboxed for HTML exports.
- **Mutations.** Every mutation is an HTML form POST to a route handler. `formHandler` checks the origin and redirects back with a readable error. There is no client-side JavaScript state to trust.
- **Sessions.** Looked up by the hash of the cookie token. The organisation comes from membership, and every tenant query runs inside `withOrg(orgId, …)`, which sets `app.org_id` for that transaction only. The database's FORCE row-level security does the rest.

### Scan path (hosted)

1. A user triggers a scan (manual, upload, push webhook, or the daily schedule). The web process inserts a `scans` row and a `jobs` row in the same tenant transaction.
2. A worker claims the job with `FOR UPDATE SKIP LOCKED`, marks the scan running, and creates a `mkdtemp` work directory (0700).
3. **Clone:**
   - *GitHub:* an installation token scoped to that one repository with read permissions, passed through an askpass script.
   - *GitLab:* the decrypted project token, with the host re-resolved, checked and pinned (`http.curloptResolve`).
   - *Upload:* the encrypted ZIP is fetched and extracted with zip-slip and bomb protection.
4. **Analyse.** The worker spawns `runner.mjs` with a minimal environment, a 4 GB heap cap and a timeout. The runner calls `analyze`, runs the invariants, and writes the dossier to the work directory. Timeouts kill the whole process group.
5. **Store.** Sign with the platform key (PLATFORM_ATTESTED), encrypt the body bound to its storage key, write the ledger row (digest, envelope), diff against the previous snapshot into `change_events`, and audit.
6. **Clean up.** Delete the work directory and, for uploads, the uploaded archive, whatever the outcome. A failure is recorded on the scan in sanitised form, and nothing partial is published.

### CLI push path

`POST /api/v1/dossiers` with a Bearer API token (stored hashed; it can only upload):

- the server re-runs the invariants on the pushed dossier;
- if the push is signed, it verifies the DSSE envelope against the supplied public key, checks that the envelope's subject digest matches the dossier, and stores it as SELF_ATTESTED with the signer's key id;
- an unsigned push is stored and shown as "not signed".

A dossier that breaks its invariants, or whose signature doesn't match, gets 422.

### Verification path

- `/verify` accepts a dossier and an envelope and reports signature validity, digest match and attestation level. No account needed.
- `acquicode verify --reproduce` goes further: it re-runs the analysis on the named repositories and compares digests.

### Continuous mode

- **Triggers.** Push webhooks (GitHub, GitLab) and a daily schedule queue scans for repositories with monitoring on.
- **Diffs.** Each new snapshot is diffed against the previous one: readiness, findings (matched by fingerprint), questions, dependencies, licenses, advisories, AI evidence, tools, contributors, moved repositories and changed files.
- **Timeline.** Material changes are listed on the repository timeline.

## 4. Why this architecture

| Choice | Reason | Rejected alternative |
|---|---|---|
| Deterministic engine, no LLM | Verification by reproduction; confidentiality; no prompt-injection surface | LLM summaries (non-reproducible, send code to a vendor) |
| One engine for CLI and hosted | The same dossier from either path; local-first for sensitive code | Separate hosted scanner |
| PostgreSQL for data, queue, rate limits and tenant isolation | One stateful dependency for a small team; RLS enforces tenancy below the application | Redis + a queue + per-tenant schemas |
| Forced RLS plus definer lookups plus a refusing migrator | Isolation holds even if application code forgets a filter, and even on managed Postgres | Application-level `WHERE org_id` only |
| Application-level encryption with key ids | Works identically on a filesystem and on S3; rotation without downtime | Relying on disk or bucket encryption alone |
| Worker spawns an isolated analysis child | Memory and time limits; the child never sees application secrets | Analysing inside the web process |
| HTML forms, not a SPA | Fewer moving parts, works without JS, CSRF is simple to enforce | Client-side app with an API token in the browser |
| Standard formats: DSSE, in-toto, CycloneDX, Agent Trace, git-ai | Buyers and tools can consume them without us | A proprietary report format |

## 5. Repository layout

```
acquicode/
  packages/engine     evidence engine (library)
  packages/cli        acquicode CLI
  apps/web            web app, worker, migrations (Next.js)
  deploy/             compose helpers, Postgres init, Caddyfile, smoke check
  docs/               this documentation
  Dockerfile, docker-compose.yml
```
