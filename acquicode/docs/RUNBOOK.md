# Runbook

Operational procedures for a hosted deployment. Commands assume the Docker Compose layout (DEPLOYMENT.md). With another orchestrator, run the same commands inside the image.

## 1. Health

| Check | How | Healthy |
|---|---|---|
| Web up | `GET /api/health` | 200 |
| Database and migrations | `GET /api/ready` | `{"status":"ready","migrations":N}` with N = number of files in `db/migrations` |
| End-to-end without credentials | `node deploy/smoke.mjs https://…` | "all checks passed" |
| Worker alive | Logs show `worker starting`; `SELECT kind, status, count(*) FROM jobs GROUP BY 1,2;` | `purge` and `schedule` jobs exist and progress |
| Scans flowing | `SELECT status, count(*) FROM scans WHERE created_at > now() - interval '1 day' GROUP BY 1;` | Few `failed`, none stuck in `running` |

Logs are JSON (pino) and contain ids, counts, durations and sanitised errors. They never contain source code, tokens or dossier bodies. If you ever find one that does, treat it as an incident (§6).

## 2. Routine operations

**Deploy a release.** Build and push the image, run `migrate` (safe to run from several jobs at once), then roll web and worker. Workers finish their current job on SIGTERM.

**Set a plan by hand** (no Stripe, or an enterprise deal). Run as the schema owner:
```sql
UPDATE orgs SET plan = 'acquirer', plan_expires_at = now() + interval '365 days' WHERE id = '<org uuid>';
```
Plans: `free`, `readiness`, `custody`, `acquirer`, `enterprise`. `plan_expires_at = NULL` means no expiry. Expired plans fall back to `free` automatically.

**Grant a support person access to an organisation.** Don't. Ask an owner to invite them from Settings, so the access is visible in the members list and the audit log.

**Delete a customer's data on request.** The owner can do it in Settings → Delete organisation. If they cannot, run as the schema owner:
```sql
DELETE FROM jobs WHERE org_id = '<org>';
DELETE FROM orgs WHERE id = '<org>';   -- cascades to every tenant table, including audit events
```
Then delete `orgs/<org>/` from blob storage. Record the request and its completion outside the database, because the organisation's own audit trail is deleted with it.

**Retention.** The `purge` job runs about hourly. It deletes dossier bodies older than each organisation's retention period, plus expired sessions, old rate-limit rows, webhook ids and finished jobs. Digests stay in the `dossiers` ledger.

## 3. Failed and stuck scans

- **Why a scan failed.** `SELECT id, error FROM scans WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20;`. Errors are sanitised; the worker log line with the same `jobId` has timing.
- **Common causes:**

| Cause | Fix |
|---|---|
| GitHub installation removed or suspended | The customer reinstalls; the webhook already cleared `installation_id`. |
| GitLab token expired | The customer reconnects with a new project access token. |
| `analysis exceeded …s` | The repository is very large. Raise `SCAN_TIMEOUT_SECONDS` for the worker, or have the customer use the CLI. |
| `Dossier violates its evidence rules` | An engine bug: the invariants refused to emit an inconsistent dossier. Keep the scan id and open an issue. Never bypass the invariants. |

- **Retries.** Jobs retry automatically only on infrastructure-looking errors, with backoff. A scan failure is recorded on the scan, and the user can re-run it.
- **Stuck jobs.** Workers requeue jobs whose worker died after `SCAN_TIMEOUT_SECONDS + 15 min`. To requeue by hand:
  ```sql
  UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '1 hour';
  ```

## 4. Key management

### Rotate the data encryption key

1. Generate a key: `openssl rand -base64 32`.
2. **Prepend** it: `DATA_ENCRYPTION_KEYS=k2026b:<new>,k2026a:<old>`. Deploy web and worker. New data is encrypted with the new key; old data still decrypts.
3. Re-encrypt everything at rest with the current key:
   ```sh
   docker compose run --rm worker node dist-node/worker/reencrypt.mjs
   # {"currentKey":"k2026b","credentials":{"checked":3,"reencrypted":3},"blobs":{"checked":41,"reencrypted":41,"missing":0}}
   # On a single-service platform, run the same command from a one-off shell in the service.
   ```
   It is idempotent: run it again and it reports 0 re-encrypted.
4. Remove the old key from `DATA_ENCRYPTION_KEYS` and deploy.
5. Keep the old key in your secret manager, marked retired, for as long as backups made before step 3 are retained.

### Rotate the platform signing key

1. Generate a key: `openssl genpkey -algorithm ed25519`, or `acquicode keygen`.
2. Save the current public key (`/.well-known/acquicode-signing-key.pem`) and **append** it to `PLATFORM_RETIRED_PUBLIC_KEYS` (PEM blocks one after another; `\n`-escaped is accepted).
3. Set `PLATFORM_SIGNING_KEY` to the new key and deploy. New dossiers are signed with it.
4. Check `/.well-known/acquicode-keys.json`: the new key is `current`, the old one `retired`. `/verify` accepts both, so dossiers signed before the rotation still show as platform-attested.

Never remove a retired key while dossiers it signed may still be presented to a buyer.

### Other keys

- **GitHub App private key:** generate a new key in the App settings, deploy it, then delete the old one in GitHub. If the App was created through `/setup`, deploy the new key as the `GITHUB_*` variables (they take precedence over the stored App), or delete the `github_app` row in `platform_secrets` and run setup again.
- **`SETUP_TOKEN`:** only needed until GitHub is connected. Remove it from the environment afterwards; the checklist on `/setup` then needs it re-added to be shown.
- **Webhook secrets:** change them at GitHub or Stripe and in configuration at the same time. Deliveries in between fail and are retried by the sender.

## 5. Backups and restore

- **PostgreSQL:** use your provider's point-in-time recovery, or `pg_dump` as the schema owner. Dumps contain encrypted credentials (GitLab tokens, notification endpoints, a GitHub App created through `/setup`) and hashed tokens, never plaintext secrets.
- **Blobs:** back up the volume or bucket. Every object is application-encrypted.
- **Restoring needs both, and the encryption keys that were current when they were taken.** Without the keys, blobs and credentials cannot be decrypted. That is intended, but it means keys must be backed up separately and securely.

## 6. Incidents

| Incident | Immediate actions |
|---|---|
| Suspected cross-tenant access | Take web offline if it is ongoing. Query `audit_events` for the affected ids and the actor's IP. RLS blocks this by design, so check whether a role was changed (`\du`: the app role must be NOSUPERUSER, NOBYPASSRLS). Notify affected customers. |
| Data encryption key exposed | Rotate (§4) immediately, then assume blob and database backups made with that key are readable by whoever holds it. |
| Platform signing key exposed | Rotate. Publish the compromised key id as revoked. Dossiers signed after the exposure time cannot be trusted as platform-attested. |
| GitHub App private key exposed | Delete the key in GitHub (it takes effect immediately) and deploy a new one. Installation tokens already minted expire within an hour. |
| Secret or source code found in logs | Delete the log stream segment, find the code path and fix it with a test (log hygiene tests live in `apps/web/test/unit.test.ts`). |
| Worker compromised | A worker handles plaintext clones while scanning. Rotate the GitHub App key and ask affected GitLab customers to rotate their project tokens. Review egress logs. |
