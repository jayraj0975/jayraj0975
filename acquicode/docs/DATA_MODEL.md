# Data model

Two models: the **dossier** (the product, portable and signed) and the **database** (the hosted service's state). The dossier is the source of truth for what was found; the database indexes dossiers and holds everything around them.

## 1. The dossier (`acquicode.dossier/1`)

Canonical JSON (sorted keys, no insignificant whitespace). Its identity is `sha256(canonicalJson(dossier))`. Type definitions: `packages/engine/src/model.ts`.

| Field | Contents |
|---|---|
| `schema`, `analyzer` | Schema id; analyzer name, version and rules version. |
| `title`, `subjects[]` | What was analysed. Each subject has its name (from the remote), kind (git or directory), remote (credentials redacted), head commit, tree id, branch, and a `contentDigest` over the sorted (path, sha256) table. |
| `declarations` | Whether company declarations were supplied, their digest and source, the declared distribution model and AI usage. |
| `options` | Every option that affects output, including `asOf`, limits and enrichment switches. |
| `coverage` | What was and wasn't analysed: files scanned or skipped (by reason), bytes, history (shallow, truncated, commits analysed, root commits, notes refs), history secret scan, blame coverage, enrichment calls, limits. |
| `readiness` | `READY` / `REVIEW` / `BLOCKED` plus de-duplicated reasons. |
| `summary` | Templated headline, paragraphs, counts by materiality, top findings. |
| `inventory` | Languages, file classes, manifests, lockfiles, submodules, vendored roots, generated files, binaries, CI systems, container files, agent configuration files. |
| `ownership` | Contributors (clustered identities, class and its state, commits and lines, first/last commit, how identities were merged, matched IP agreement), whether a register was supplied, and history coverage. |
| `aiDevelopment` | File counts per evidence category, line counts (only when line-level records exist), commit counts (direct evidence, editor-trailer-only, via PR, pushed directly), review evidence, tools (with state, signals, models, first and last seen, declared terms), repository-level signals. |
| `components[]`, `dependencies[]` | One component per manifest, and every dependency with ecosystem, version, direct/transitive, scope, source (lockfile, manifest or vendored), resolved URL, integrity, a `private` flag, install scripts, license conclusion (expression, categories, certainty, source), and evidence. |
| `licenses` | Project license conclusion and dependency license summary. |
| `metrics` | Numeric metrics (bus factor, key-person share, …) or `null` when not computable. |
| `findings[]` | `rule`, `ruleVersion`, `area`, `title`, `materiality`, `state`, `audience[]`, `summary`, `evidence[]` (ids), `fingerprint` (stable across snapshots), and optional `suppressed` (reason, by, state). |
| `questions[]` | Diligence answers: `status`, `state`, `rationale`, `findings[]`, `unknowns[]`, `followUps[]` (audience plus question). |
| `unknowns[]` | `statement`, `why`, `resolveBy`, `material`. |
| `evidence[]` | Id, `kind`, `detector` (rule@version), `state`, optional `evidenceClass` (DIRECT, CORROBORATING or INFERENCE), `locator` (repository, commit, path, lines, source), an optional short redacted `extract`, and scalar `attributes`. Never source code, never secrets. |
| `files[]` | Path, size, sha256, classes, language, lines, why content was skipped (if it was), the last commit, and the per-file AI status (`category`, `aiLines`, `humanLines`, `linesFromAiCommits`, `tools`, `evidence`, `state`). |
| `commits[]` | AI-attributed commits, root commits and the newest 500. Id, dates, author class, redacted subject, trailers, signed flag, pull request, AI signals. |
| `enrichment` | Every enrichment response used (OSV, registries, forge), so a verifier can replay them offline. |

**Ids:**

- **Evidence, finding, unknown and contributor ids** are content-addressed: `stableId(prefix, …parts)` hashes the canonical inputs. Two runs on the same commits produce the same ids.
- **Fingerprints** identify a finding across snapshots, independent of its evidence ids, so diffs and suppressions survive unrelated changes.

**History is never overwritten.**

- A dossier is immutable once produced.
- Change over time is represented by new snapshots and `diffDossiers(old, new)`, which lists the material events between them.
- In the hosted product, every snapshot's digest stays in the ledger even after retention removes its body.

### Signed statement

The DSSE envelope (`application/vnd.in-toto+json`) carries an in-toto Statement v1:

- **Subject:** each analysed repository (`gitCommit` plus the content digest) and `dossier.json` by its digest.
- **Predicate type:** `https://acquicode.com/attestation/dossier/v1`.
- **Predicate:** analyzer and rules versions, schema, dossier digest, readiness, the options, the enrichment calls made, and the attestation (level `SELF_ATTESTED` or `PLATFORM_ATTESTED`, producer, time, and what the level means). Optional artifact hashes cover the dossier file and the SBOM.
- **Signature:** Ed25519, key id `ed25519:` + 32 hex characters of the SPKI hash.

### CycloneDX

1.6 JSON with purls for public packages and a deterministic serial number. `compositions` declares per ecosystem whether the inventory is `complete` (every manifest has a lockfile), `incomplete` or `unknown`. The SBOM never claims completeness it doesn't have.

## 2. The database (PostgreSQL 16)

Migrations: `apps/web/db/migrations/`.

### Global tables (no tenant)

| Table | Purpose |
|---|---|
| `users` | GitHub identity (numeric id, login, name, email). |
| `sessions` | `id_hash` (SHA-256 of the cookie token), user, expiry, IP, user agent. |
| `orgs` | Name, plan, plan expiry, credits, retention (7–3,650 days), enrichment switch, Stripe customer. |
| `memberships` | (org, user, role: owner, admin, member or viewer). |
| `jobs` | Queue: kind (scan, purge, schedule), payload, status, attempts, `run_after`, lock owner. |
| `rate_limits` | Fixed-window counters. |
| `webhook_deliveries` | De-duplication of GitHub, GitLab and Stripe deliveries. |
| `schema_migrations` | Applied migrations. |

### Tenant tables: FORCE ROW LEVEL SECURITY on `org_id = current_org_id()`

| Table | Purpose |
|---|---|
| `repositories` | Provider (github, gitlab, upload or cli), external id, full name, default branch, clone URL, installation id, **encrypted** GitLab token, hashed webhook secret, monitoring switch. |
| `scans` | Status, trigger, ref, commit, readiness, counts, digest, attestation, signer key id, sanitised error, timings, pending upload key. |
| `dossiers` | Ledger entry per snapshot: storage key of the encrypted body, DSSE envelope, digest, size. |
| `change_events` | Material differences between consecutive snapshots. |
| `declarations` | Versioned company declarations (YAML) per repository. Each save is a new row; nothing is edited in place. |
| `share_links` | Hashed token, label, expiry, revocation, view count, last view. |
| `api_tokens` | Hashed token, prefix, scopes (`dossiers:write`), expiry, last use, revocation. |
| `invitations` | Pending invitations bound to a GitHub numeric id (the login is kept for display). |
| `github_installations` | Installation → organisation (unique), account, suspension. |
| `audit_events` | Append-only: actor type and id, action, target, IP, metadata. UPDATE and DELETE are revoked from the app role; a trigger rejects updates from anyone. |

### Definer functions (pre-authentication lookups)

These return ids only, never tenant data. EXECUTE is revoked from PUBLIC and granted to the app role.

- `resolve_share_link(hash)`
- `resolve_api_token(hash)`
- `resolve_installation(id)`
- `resolve_repository(id)`
- `monitored_repositories()`
- `claim_invitations(github_id, user)`

### Blobs (filesystem or S3, application-encrypted)

| Key | Contents | Lifetime |
|---|---|---|
| `orgs/{org}/dossiers/{scan}.json` | Dossier body | The organisation's retention period |
| `orgs/{org}/uploads/{scan}.zip` | Uploaded archive | Until the scan finishes (deleted whatever the outcome) |

Blob format: `ACQ1 | kid length | kid | iv(12) | tag(16) | ciphertext`, AES-256-GCM with the storage key as associated data.

Database secrets use `v1.kid.iv.tag.ciphertext`, with the record's identity (`repo:{id}`) as associated data.
