# Deployment

AcquiCode ships as **one container image** that runs three processes, plus PostgreSQL 16 or newer and storage:

| Process | Command | Scales | Needs |
|---|---|---|---|
| web | `node server.js` (default) | horizontally, stateless | database, blob storage, `APP_URL` |
| worker | `node dist-node/worker/index.mjs` | horizontally (jobs are claimed with `FOR UPDATE SKIP LOCKED`) | database, blob storage, `git`, outbound HTTPS to GitHub/GitLab (and OSV/npm/PyPI if enrichment is on) |
| migrate | `node dist-node/scripts/migrate.mjs` | once per release, before web and worker | the **schema owner** connection |
| all-in-one | `node dist-node/scripts/start.mjs` | one container | everything above: migrates, then runs web and worker together, and exits if either stops |

The all-in-one entry point is for platforms that run one process per service (Railway, Render, Fly). Section 2 is a complete example.

After any deployment, open `{APP_URL}/setup`: it connects GitHub in one click (section 6) and shows a checklist of what is still unconfigured.

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

## 2. One service on Railway

This is how the reference deployment runs: one service built from this repository, Railway PostgreSQL, and a Railway bucket (S3-compatible) for encrypted blobs. No volume is needed, so the image keeps running as its unprivileged user.

1. Create a project with the **PostgreSQL** template and a **bucket**.
2. Add a service from the GitHub repository with:
   - root directory `/acquicode` (the Dockerfile is found there);
   - start command `node dist-node/scripts/start.mjs`;
   - healthcheck path `/api/health` (timeout 180 s: the first start applies migrations);
   - restart policy "on failure".
3. Generate a public domain, then set the service variables. `${{...}}` are Railway references; `acquicode-blobs` is the bucket's name.

   | Variable | Value |
   |---|---|
   | `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
   | `DATABASE_MIGRATION_URL` | `${{Postgres.DATABASE_URL}}` (the owner account Railway provides) |
   | `APP_DB_PASSWORD` | a random password; the first start creates `acquicode_app` with it |
   | `DATABASE_URL` | `postgresql://acquicode_app:<that password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
   | `DATA_ENCRYPTION_KEYS` | `k<date>:<base64 of 32 random bytes>` (`openssl rand -base64 32`) |
   | `PLATFORM_SIGNING_KEY` | `openssl genpkey -algorithm ed25519`, newlines written as `\n` |
   | `SETUP_TOKEN` | a random string of 24+ characters, for `/setup` |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION` | `${{acquicode-blobs.BUCKET}}`, `${{acquicode-blobs.ENDPOINT}}`, `${{acquicode-blobs.REGION}}` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `${{acquicode-blobs.ACCESS_KEY_ID}}`, `${{acquicode-blobs.SECRET_ACCESS_KEY}}` |
   | `TRUST_PROXY` | `1` (Railway's edge proxy) |
   | `WORK_DIR` | `/tmp/acquicode-work` |
   | `WORKER_CONCURRENCY` | `1` on small instances (1 GB of memory on the trial) |
   | `HOSTING_PROVIDER` | `Railway` (listed on the subprocessors page) |
   | `CONTACT_EMAIL`, `LEGAL_ENTITY` | your real contact address and company name, when you have them |
4. Deploy, run `node deploy/smoke.mjs https://<domain>`, then open `https://<domain>/setup` and connect GitHub.

Keep a copy of `DATA_ENCRYPTION_KEYS` outside Railway: without it, stored dossiers and credentials cannot be decrypted.

## 3. Building the image

```sh
docker build -t acquicode:<version> .
```

- **Base image.** The runtime stage defaults to `node:22-bookworm-slim` and installs `git` with apt. If Debian mirrors are unreachable from your build environment, any Debian-based Node 22 image that already ships git works, and the apt step is skipped: `--build-arg RUNTIME_BASE=node:22-bookworm`.
- **Behind a TLS-inspecting proxy**, put the proxy's CA certificate in `deploy/ca/` (as `*.pem`; git-ignored) and pass the proxy:
  ```sh
  cp /path/proxy-ca.pem deploy/ca/ && docker build --build-arg HTTPS_PROXY -t acquicode .
  ```
  The certificate is trusted only for the install and build steps and is removed from the runtime image. The Dockerfile uses no BuildKit-only features, so hosted builders (Railway, Render) build it unchanged.
- **Runtime.** Runs as UID 10001, and includes a `HEALTHCHECK` on `/api/health`. Run it with an init process (`docker run --init`, compose `init: true`), although the worker also kills whole process groups on timeouts.

## 4. Configuration

All configuration is environment variables, validated at start-up (`apps/web/lib/config.ts`). Invalid or unsafe production settings stop the process instead of running degraded.

| Variable | Required | Meaning |
|---|---|---|
| `APP_URL` | yes | Public URL. Must be `https://` in production; `http://localhost`/`127.0.0.1` is allowed for local runs. |
| `DATABASE_URL` | yes | The **application role** connection (`acquicode_app`). |
| `DATABASE_MIGRATION_URL` | migrate / all-in-one | The **schema owner** connection. `start.mjs` skips migrations when it is unset. |
| `APP_DB_PASSWORD` | no | With it, migrations create the application role (NOSUPERUSER, NOBYPASSRLS, no CREATEDB/CREATEROLE) if it does not exist yet: for platforms that hand out a single owner account. |
| `APP_DB_ROLE` | migrate only | Name of the application role (default `acquicode_app`). Migrations refuse to run if it is a superuser, has BYPASSRLS, owns the schema or is a member of the owner role. |
| `DATABASE_SSL` | no | `off`, `require` or `verify`. |
| `DATA_ENCRYPTION_KEYS` | **yes in production** | `kid:base64(32 bytes)[,kid:key…]`. The first key encrypts; all keys decrypt. See RUNBOOK.md for rotation. |
| `PLATFORM_RETIRED_PUBLIC_KEYS` | after a rotation | Public keys (PEM, one after another) that signed platform dossiers before the current key. Published at `/.well-known/acquicode-keys.json` so older dossiers stay verifiable. See RUNBOOK.md. |
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
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | for GitHub | See §6. Not needed when GitHub is connected through `/setup`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | for GitHub sign-in and connecting | The **GitHub App's** client credentials, not a separate OAuth App: connecting an installation calls `/user/installations`, which accepts only GitHub App user tokens. |
| `GITHUB_WEBHOOK_SECRET` | for GitHub | Webhook HMAC secret. Without it, every webhook is rejected. |
| `GITHUB_API_URL`, `GITHUB_WEB_URL` | GHES | For GitHub Enterprise Server. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for billing | See §7. Without them, billing is shown as "not configured" and plans are set by an operator. |
| `SETUP_TOKEN` | recommended | 24+ characters. Unlocks `/setup`, where the operator creates the GitHub App from a manifest and sees the deployment checklist. Setup closes once an App is stored or the GitHub variables are set. |
| `CONTACT_EMAIL`, `SECURITY_EMAIL` | recommended | Shown in the footer, the legal pages and `/.well-known/security.txt`. Never derived from the host name: unset means not shown (and security.txt returns 404). |
| `LEGAL_ENTITY` | recommended | The company named in the Terms and Privacy pages. |
| `HOSTING_PROVIDER` | recommended | Listed on the subprocessors page, e.g. `Railway` or `Amazon Web Services (eu-west-1)`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | s3 | Read by the AWS SDK for the S3 driver (or use an instance role). |
| `ACQUICODE_DEV_LOGIN` | never in production | Development-only sign-in. Refused when `NODE_ENV=production`. |
| `LOG_LEVEL` | no | pino level (default `info`). |

## 5. Database

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

## 6. GitHub App

**The quick way: `/setup`.** With `SETUP_TOKEN` set and no GitHub variables, open `{APP_URL}/setup`, enter the token, optionally name a GitHub organisation, and press *Create*. GitHub creates the App from a manifest with exactly the settings below and returns its id, private key, client secret and webhook secret to `/api/setup/github/callback`; AcquiCode stores them encrypted with `DATA_ENCRYPTION_KEYS` (table `platform_secrets`). Only the browser that unlocked setup, holding a state AcquiCode issued, can complete this, and only once. Environment variables, when present, always win.

**By hand.** Create a GitHub App (organisation or personal) with:

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

## 7. Stripe (optional)

- Webhook endpoint: `{APP_URL}/api/billing/webhook`.
- Events: `checkout.session.completed`, `customer.subscription.deleted`.
- Checkout sessions are created server-side with inline prices from `apps/web/lib/plans.ts`, so no Stripe products need to be configured.
- Signatures are verified with a five-minute tolerance, and deliveries are de-duplicated.

## 8. GitLab

- **Connecting.** Nothing to deploy. Customers connect a project with a project access token (`read_repository`, `read_api`), and it is encrypted at rest.
- **Self-managed hosts.** These are resolved and checked against private and reserved address ranges. The connection, and later every clone, is pinned to the checked address. The clone URL is built from the host the customer typed, never taken from the GitLab API response.
- **Workers.** In production, also give workers an egress policy that denies private ranges. That is the network-level backstop to the application checks.

## 9. After deploying

```sh
node deploy/smoke.mjs https://acquicode.example.com
```

Then open `{APP_URL}/setup` and work through its checklist (GitHub, signing key, payments, contact details, proxies).

The smoke check needs no credentials. It covers:

- health;
- that stylesheets and scripts are served (a standalone build without its static assets renders unstyled);
- the database connection and applied migrations;
- security headers (including HSTS on https);
- the analysis engine and git inside the image, by building the sample dossier;
- the sign-in redirect;
- the published signing key.

## 10. What is deliberately not included

- No Redis, Kubernetes manifests or queue broker. PostgreSQL is the queue.
- No SSO/SAML yet (GitHub sign-in only). See ROADMAP.md.
- No self-hosted worker agent for customers who must keep code on their network. Today that need is met by the CLI plus `push`, which uploads only the dossier.
