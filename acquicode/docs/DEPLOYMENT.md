# Deployment

AcquiCode ships as **one container image** that runs three processes, plus PostgreSQL 16 and storage:

| Process | Command | Scales | Needs |
|---|---|---|---|
| web | `node server.js` (default) | horizontally, stateless | database, blob storage, `APP_URL` |
| worker | `node dist-node/worker/index.mjs` | horizontally (jobs are claimed with `FOR UPDATE SKIP LOCKED`) | database, blob storage, `git`, outbound HTTPS to GitHub/GitLab (and OSV/npm/PyPI if enrichment is on) |
| migrate | `node dist-node/scripts/migrate.mjs` | once per release, before web and worker | the **schema owner** connection |

The CLI (`packages/cli`) needs no deployment: it runs where the code lives and can `push` dossiers to a workspace.

## 1. Quick start with Docker Compose

```sh
cd acquicode
./deploy/generate-env.sh > .env      # fresh database passwords, encryption key, signing key
$EDITOR .env                          # set APP_URL; optionally GitHub App, Stripe, S3
docker compose up -d --build
node deploy/smoke.mjs http://127.0.0.1:3000
```

What the compose file does (`docker-compose.yml`):

- **db**: PostgreSQL 16. On first start, `deploy/postgres-init/01-roles.sh` creates `acquicode_owner` (owns the database, **not** a superuser) and `acquicode_app` (NOSUPERUSER, NOBYPASSRLS, cannot create objects). This mirrors a managed database, so what you test locally is what runs in production.
- **migrate**: runs once as `acquicode_owner`, then exits. Web and worker start only after it succeeds.
- **web** and **worker**: get only the application's own settings. The owner and superuser passwords are never passed to them.
- **Blob volume**: web and worker share an encrypted blob volume (`/data`).
- **Worker clones**: clones live on the worker's own ephemeral filesystem (`WORK_DIR=/tmp/acquicode-work`) and are deleted after every scan.
- **TLS**: `docker compose --profile tls up -d` adds Caddy with automatic HTTPS for `$DOMAIN`. With it, set `TRUST_PROXY=1`.

Verified: the image builds from the slim base in CI, the stack starts, migrations apply as the non-superuser owner, and the smoke checks pass. An uploaded archive has been analysed end to end by the containerised worker into a platform-attested dossier.

## 2. Building the image

```sh
docker build -t acquicode:<version> .
```

- **Base image.** The runtime stage defaults to `node:22-bookworm-slim` and installs `git` with apt. If Debian mirrors are unreachable from your build environment, any Debian-based Node 22 image that already ships git works, and the apt step is skipped: `--build-arg RUNTIME_BASE=node:22-bookworm`.
- **Behind a TLS-inspecting proxy**, pass the proxy and its CA:
  ```sh
  docker build --build-arg HTTPS_PROXY --secret id=extra_ca,src=/path/proxy-ca.pem -t acquicode .
  ```
  The CA is mounted only for the install steps, and is not left in the image.
- **Runtime.** Runs as UID 10001, and includes a `HEALTHCHECK` on `/api/health`. Run it with an init process (`docker run --init`, compose `init: true`), although the worker also kills whole process groups on timeouts.

## 3. Configuration

All configuration is environment variables, validated at start-up (`apps/web/lib/config.ts`). Invalid or unsafe production settings stop the process instead of running degraded.

| Variable | Required | Meaning |
|---|---|---|
| `APP_URL` | yes | Public URL. Must be `https://` in production; `http://localhost`/`127.0.0.1` is allowed for local runs. |
| `DATABASE_URL` | yes | The **application role** connection (`acquicode_app`). |
| `DATABASE_MIGRATION_URL` | migrate only | The **schema owner** connection. |
| `APP_DB_ROLE` | migrate only | Name of the application role (default `acquicode_app`). Migrations refuse to run if it is a superuser, has BYPASSRLS, owns the schema or is a member of the owner role. |
| `DATABASE_SSL` | no | `off`, `require` or `verify`. |
| `DATA_ENCRYPTION_KEYS` | **yes in production** | `kid:base64(32 bytes)[,kid:key…]`. The first key encrypts; all keys decrypt. See RUNBOOK.md for rotation. |
| `PLATFORM_SIGNING_KEY` | recommended | Ed25519 private key (PEM, `\n`-escaped is accepted). Signs hosted dossiers as PLATFORM_ATTESTED. The public half is served at `/.well-known/acquicode-signing-key.pem`. Without it, hosted dossiers are unsigned and the UI says so. |
| `SESSION_TTL_HOURS` | no | Default 168. |
| `STORAGE_DRIVER` | no | `fs` (default) or `s3`. |
| `STORAGE_DIR` | fs | Blob directory (image default `/data/blobs`). Must be shared by web and worker. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | s3 | S3 or a compatible store. Blobs are encrypted by the app before upload; SSE is requested as well. |
| `WORK_DIR` | no | Worker scratch space for clones. Should be ephemeral. |
| `MAX_UPLOAD_MB` | no | Default 200. |
| `SCAN_TIMEOUT_SECONDS` | no | Default 1800. The analysis child process is killed after this. |
| `WORKER_CONCURRENCY` | no | Jobs per worker process (default 2). Each analysis may use up to 4 GB of memory. |
| `TRUST_PROXY` | no | Number of reverse proxies that append to `X-Forwarded-For`. `0` (default): client IPs are recorded as `unknown`, and anonymous rate limits share one larger bucket. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | for GitHub | See §5. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | for GitHub sign-in and connecting | The **GitHub App's** client credentials, not a separate OAuth App: connecting an installation calls `/user/installations`, which accepts only GitHub App user tokens. |
| `GITHUB_WEBHOOK_SECRET` | for GitHub | Webhook HMAC secret. Without it, every webhook is rejected. |
| `GITHUB_API_URL`, `GITHUB_WEB_URL` | GHES | For GitHub Enterprise Server. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for billing | See §6. Without them, billing is shown as "not configured" and plans are set by an operator. |
| `ACQUICODE_DEV_LOGIN` | never in production | Development-only sign-in. Refused when `NODE_ENV=production`. |
| `LOG_LEVEL` | no | pino level (default `info`). |

## 4. Database

PostgreSQL 16 or newer. Managed services (RDS, Cloud SQL, Azure Database) work; the schema never assumes a superuser.

1. Create two roles and a database (adapt to your provider's console):
   ```sql
   CREATE ROLE acquicode_owner LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE acquicode_app   LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
   CREATE DATABASE acquicode OWNER acquicode_owner;
   REVOKE ALL ON DATABASE acquicode FROM PUBLIC;
   GRANT CONNECT ON DATABASE acquicode TO acquicode_app;
   ```
2. Run migrations with `DATABASE_MIGRATION_URL` pointing at the owner, and set `APP_DB_ROLE=acquicode_app`. Migrations are transactional per file and serialised with an advisory lock, so running them from several release jobs at once is safe.
3. Point web and worker at the app role.

Why two roles:

- **FORCE ROW LEVEL SECURITY.** Tenant isolation is enforced by forced row-level security keyed on a per-transaction setting.
- **Definer functions.** The few lookups that happen before a tenant is known (share links, API tokens, webhooks, invitations, the scheduler) are narrow SECURITY DEFINER functions owned by the schema owner, with owner-only policies (migration 002).

The test suite runs all of this as a non-superuser owner (`apps/web/test/db.test.ts`).

## 5. GitHub App

Create a GitHub App (organisation or personal) with:

- **Repository permissions:** Contents: read, Metadata: read, Pull requests: read. Nothing else.
- **Subscribe to events:** Push, Installation, Installation repositories, Repository.
- **Webhook URL:** `{APP_URL}/api/github/webhook`, with a secret, which becomes `GITHUB_WEBHOOK_SECRET`.
- **Callback URL:** `{APP_URL}/api/auth/github/callback`.
- **Setup URL:** `{APP_URL}/api/github/setup`, with **Redirect on update** enabled.
- Leave **Request user authorization (OAuth) during installation** off. The setup URL already sends the admin through GitHub authorisation to verify the installation. The callback also accepts the combined flow, but the separate flow is the one covered by the test suite.
- Generate a private key and put it in `GITHUB_APP_PRIVATE_KEY`. Copy the App id and slug.
- Use the App's **Client ID** and a **client secret** for `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

**How connecting is secured.**

- The `installation_id` GitHub appends to the setup URL is treated as untrusted.
- An installation is bound to an organisation only if all of these hold:
  - the signed state was issued to that admin's session;
  - the GitHub account that authorises is the one the admin signed in with;
  - GitHub lists the installation in that account's `/user/installations`.
- An installation already bound to another organisation is refused.
- The end-to-end suite replays each attack against a GitHub stand-in.

**Tokens.** Installation tokens are minted per scan, scoped to the one repository and to read permissions, and never stored.

## 6. Stripe (optional)

- Webhook endpoint: `{APP_URL}/api/billing/webhook`.
- Events: `checkout.session.completed`, `customer.subscription.deleted`.
- Checkout sessions are created server-side with inline prices from `apps/web/lib/plans.ts`, so no Stripe products need to be configured.
- Signatures are verified with a five-minute tolerance, and deliveries are de-duplicated.

## 7. GitLab

- **Connecting.** Nothing to deploy. Customers connect a project with a project access token (`read_repository`, `read_api`), and it is encrypted at rest.
- **Self-managed hosts.** These are resolved and checked against private and reserved address ranges. The connection, and later every clone, is pinned to the checked address. The clone URL is built from the host the customer typed, never taken from the GitLab API response.
- **Workers.** In production, also give workers an egress policy that denies private ranges. That is the network-level backstop to the application checks.

## 8. After deploying

```sh
node deploy/smoke.mjs https://acquicode.example.com
```

The smoke check needs no credentials. It covers:

- health;
- the database connection and applied migrations;
- security headers (including HSTS on https);
- the analysis engine and git inside the image, by building the sample dossier;
- the sign-in redirect;
- the published signing key.

## 9. What is deliberately not included

- No Redis, Kubernetes manifests or queue broker. PostgreSQL is the queue.
- No SSO/SAML yet (GitHub sign-in only). See ROADMAP.md.
- No self-hosted worker agent for customers who must keep code on their network. Today that need is met by the CLI plus `push`, which uploads only the dossier.
