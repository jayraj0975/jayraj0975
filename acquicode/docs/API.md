# API

AcquiCode has three programmatic surfaces:

- the **CLI**, where most automation belongs;
- a small **token API** for pushing dossiers from CI;
- the **HTTP routes** behind the web app.

The dossier formats themselves are in DATA_MODEL.md.

## 1. CLI

```
acquicode scan [repo-path ...] [options]      Analyse one or more repositories (default: .)
acquicode verify <dossier.json> [options]      Check a signature and/or reproduce a dossier
acquicode diff <old.json> <new.json> [--out f] What materially changed between snapshots
acquicode render <dossier.json> [--out f]      Render a dossier to standalone HTML
acquicode keygen [--out dir]                   Create an Ed25519 signing key pair
acquicode push <dossier.json> --server URL --token TOKEN [--envelope f --key pub.pem]
```

`scan` writes `dossier.json`, `dossier.html`, `sbom.cdx.json`, and with `--sign-key` also `dossier.dsse.json`. It sends nothing over the network unless one of these is given:

- `--osv`: public package names and versions to OSV.dev;
- `--registry`: public package names to npm and PyPI;
- `--github-repo` with `GITHUB_TOKEN`: pull-request approvals.

Key options: `--declarations`, `--register`, `--trace` (company-asserted), `--as-of`, `--previous` (adds a diff), `--omit-extracts`, and `--fail-on blocked|review`, which exits with code 2 for CI gating.

`verify`:

- `--envelope` with `--key`: checks the DSSE signature against a trusted public key and the dossier digest.
- `--reproduce <path>…`: re-runs the analyzer on the given repositories with the dossier's recorded options and enrichment, and compares digests.

Exit code 0 means everything requested passed.

`push` refuses plain HTTP except to localhost.

A CI example (GitHub Actions):

```yaml
# SIGNING_KEY holds acquicode-signing.key.pem; the public half is committed as .acquicode/signing.pub.pem
- run: printf '%s' "$SIGNING_KEY" > "$RUNNER_TEMP/signing.key.pem"
  env: { SIGNING_KEY: "${{ secrets.ACQUICODE_SIGNING_KEY }}" }
- run: acquicode scan . --osv --sign-key "$RUNNER_TEMP/signing.key.pem" --fail-on blocked
- run: acquicode push acquicode-out/dossier.json --server https://app.acquicode.com --token "$ACQUICODE_TOKEN" --envelope acquicode-out/dossier.dsse.json --key .acquicode/signing.pub.pem
  env: { ACQUICODE_TOKEN: "${{ secrets.ACQUICODE_TOKEN }}" }
```

(The CLI is not yet published to npm; build it from `packages/cli` until it is.)

## 2. Token API

### `POST /api/v1/dossiers`

Uploads a dossier (no source code) into the organisation that owns the token.

- **Auth:** `Authorization: Bearer acq_…`. Tokens are stored hashed, expire, and can only write dossiers. Two kinds exist:
  - **workspace tokens**, created by admins in Settings;
  - **request tokens**, created with a dossier request (`/app/requests`) and handed to a target company. A request token files each dossier as `<target>/<name>` in the requesting organisation, marks the request received, notifies subscribed endpoints (`request.received`), and stops working when the request is cancelled (the token is revoked with it) or expires: both answer `401`.
- **Rate limit:** 120 requests per hour per token.
- **Body** (JSON, up to 80 MB):
  ```json
  { "dossier": { "schema": "acquicode.dossier/1", "...": "..." },
    "envelope": { "payloadType": "application/vnd.in-toto+json", "payload": "…", "signatures": [{ "keyid": "ed25519:…", "sig": "…" }] },
    "publicKey": "-----BEGIN PUBLIC KEY-----\n…" }
  ```
  `envelope` and `publicKey` are optional together. Unsigned dossiers are stored and shown as not signed.
- **Responses:**

| Status | Body / meaning |
|---|---|
| `201` | `{ "scan": "<uuid>", "digest": "<sha256>", "readiness": "REVIEW", "url": "https://…/app/scans/<uuid>" }` |
| `400` | Not a dossier; signed without `publicKey` |
| `401` | Missing, invalid, expired or revoked token |
| `402` | Repository limit of the plan reached |
| `413` | Body too large |
| `422` | The dossier breaks its invariants, or the signature doesn't match the dossier |
| `429` | Rate limited |

## 3. Public HTTP routes (no account)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness. |
| GET | `/api/ready` | Database reachable; number of applied migrations. |
| GET | `/.well-known/acquicode-signing-key.pem` | Public half of the current platform signing key (404 if none is configured). |
| GET | `/.well-known/acquicode-keys.json` | Every platform key: `{ "keys": [{ "keyid", "status": "current" \| "retired", "algorithm": "ed25519", "publicKeyPem" }] }`. Dossiers signed before a rotation stay verifiable. |
| GET | `/.well-known/security.txt` | RFC 9116 contact for vulnerability reports (404 when no `SECURITY_EMAIL`/`CONTACT_EMAIL` is configured). |
| GET | `/cli/acquicode.mjs`, `/cli/acquicode.mjs.sha256` | The CLI as one file, and its SHA-256 in `shasum` format. `/cli` documents install, signing, push and CI. |
| POST | `/verify` form → `/api/verify` | Multipart `dossier`, `envelope`, optional `key`. Checks against every platform key plus the supplied key, then redirects to `/verify?r=…`, a server-signed one-hour result (signature validity, digest match, signer, attestation level, key id), so a crafted link cannot display a forged result. A manifest that claims PLATFORM_ATTESTED but is not signed by a platform key is shown as SELF_ATTESTED, with a warning. Rate limited per client. |
| GET | `/sample`, `/api/sample/download/{json,html,sbom}` | The synthetic Meridian Systems dossier (demo data, labelled). |
| GET | `/s/{token}` | Read-only shared dossier. Every view is counted and audited. |
| GET | `/api/s/{token}/download/{json,html,sbom,envelope}` | Downloads through a share link. Counted, audited, rate limited. |
| POST | `/api/github/webhook` | GitHub App webhooks (HMAC `X-Hub-Signature-256`). Events: push, installation, installation_repositories, repository. |
| POST | `/api/gitlab/webhook/{repositoryId}` | GitLab push webhooks (`X-Gitlab-Token`, the per-repository secret). |
| POST | `/api/billing/webhook` | Stripe (`Stripe-Signature`, five-minute tolerance). |

## 4. Session routes (web app)

All mutations are form POSTs with a same-origin check. On error they redirect back to the referring page with `?error=`; on success, to a page with `?notice=`. Minimum roles are shown.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/github/start` | – | Begin GitHub sign-in (signed state plus nonce cookie). |
| GET | `/api/auth/github/callback` | – | Sign-in; also completes installation verification. |
| POST | `/api/auth/logout` | any | End the session. |
| POST | `/api/github/install` | admin | Start installing the GitHub App (signed state). |
| GET | `/api/github/setup` | admin | After installation: sends the admin through GitHub authorisation to verify access (see DEPLOYMENT.md §6). |
| POST | `/api/repos/gitlab` | admin | Connect a GitLab project (URL plus project access token). |
| POST | `/api/uploads` | member | Upload a ZIP of a repository for a hosted scan. |
| POST | `/api/repos/{id}/scan` | member | Queue a scan. |
| POST | `/api/repos/{id}/monitoring` | admin | Continuous mode on or off. |
| POST | `/api/repos/{id}/declarations` | member | Save a new version of the company declarations (YAML, validated). |
| POST | `/api/repos/{id}/register` | member | Upload the IP register (CSV). |
| POST | `/api/repos/{id}/delete` | admin | Hard-delete a repository and its dossiers (type its name to confirm). |
| GET | `/api/scans/{id}/download/{json,html,sbom,envelope}` | viewer | Downloads (audited). The HTML is served under a sandbox CSP. |
| POST | `/api/scans/{id}/share` | admin | Create a read-only link (7, 30 or 90 days). The link is shown once (see "Secrets shown once" below). |
| POST | `/api/share/{id}/revoke` | admin | Revoke a link. |
| POST | `/api/settings` | admin | Organisation name, retention, enrichment. |
| POST | `/api/tokens/create`, `/api/tokens/{id}/revoke` | admin | API tokens. |
| POST | `/api/requests` | member | Create a dossier request (`target`, optional `note`, `days` 7/30/90) with its request token. At most 50 open requests. |
| POST | `/api/requests/{id}/cancel` | member | Cancel a request and revoke its token. |
| POST | `/api/notifications` | admin | Add a webhook endpoint (`url` https only, `format` json or slack, `events[]`). Needs a plan with monitoring; at most 10 per organisation. |
| POST | `/api/notifications/{id}/test`, `/api/notifications/{id}/delete` | admin | Send a signed test delivery; remove an endpoint. |
| POST | `/api/members/invite`, `/api/members/{userId}/remove` | admin | Members. Only owners can invite admins; the last owner cannot be removed. |
| POST | `/api/org/select` | any | Switch organisation. |
| POST | `/api/org/delete` | owner | Delete the organisation and everything in it. |
| POST | `/api/billing/checkout` | admin | Start Stripe Checkout for a plan. |
| POST | `/api/auth/dev` | – | Development sign-in. Disabled in production. |

**Secrets shown once.** API tokens, request tokens, share links and webhook signing secrets never travel in a URL in plain text. The creating route redirects with `?reveal=`, a value sealed with the data encryption key, bound to the signed-in user and valid for ten minutes; only that user's page render can open it.

**Operator setup** (no account; unlocked with `SETUP_TOKEN`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/setup` | Status, the GitHub App manifest form, and the deployment checklist. |
| POST | `/api/setup/unlock` | Form field `token`. Sets a signed, HttpOnly, 30-minute `acq_setup` cookie. Same-origin only; 10 attempts per 15 minutes per client. |
| GET | `/api/setup/github/callback` | GitHub's redirect after creating the App. Requires the setup cookie and a state AcquiCode issued; exchanges the one-time code at `POST /app-manifests/{code}/conversions` and stores the App encrypted. Works once. |

API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox` unless the route sets its own.

## 5. Outbound webhooks

Endpoints added in Settings receive `POST` requests for the events they subscribe to: `scan.completed`, `scan.failed`, `dossier.changed` (material change or a readiness change since the previous snapshot) and `request.received`, plus `test`.

- **Headers:** `X-AcquiCode-Event`, `X-AcquiCode-Delivery` (unique id), `X-AcquiCode-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body" with the endpoint secret>`. Reject deliveries whose `t` is more than five minutes old.
- **JSON body:** `{ event, id, occurredAt, organisation: {id, name}, message, url, repository?, scan?: {id, readiness}, changes?: {material, readinessFrom, readinessTo, highlights[]}, request?: {id, target} }`. Names, levels, counts and links only: never code, file contents, evidence extracts or secrets.
- **Slack format:** `{ "text": "…" }` for incoming webhooks, same signature header.
- **Delivery:** from the worker, https only, to public addresses only (checked at creation and again at delivery, connection pinned to the checked address), no redirects, 10-second timeout, retried with backoff. The endpoint's last status is shown in Settings.

The URL of an endpoint is itself a secret (a Slack URL lets anyone post to the channel): it is stored encrypted, and Settings shows only a hint.

## 6. Declarations file (`acquicode.yml`)

The company's statements. Every statement is recorded as USER_ASSERTED, and contradictions with the evidence are findings.

```yaml
company:
  names: [Meridian Systems]          # used to tell first-party from third-party
  domains: [meridian.io]
distribution: on_prem                # saas | on_prem | distributed | mobile | library | internal | mixed
ai_usage: some                       # none | some
ai_tools:
  - tool: claude-code
    plan: team
    indemnity: true
    duplicate_filter: true
    from: 2024-07-01
origins:
  - paths: ["src/billing/**"]
    origin: human                    # human | ai_assisted | ai_generated | third_party | generated
    declared_on: 2025-04-01
    by: CTO
contributors:                        # IP register (or --register file.csv)
  - email: ana@meridian.io
    agreement: founder_assignment
    signed_on: 2022-11-01
suppressions:
  - rule: SEC-003
    fingerprint: "<from the dossier>"
    reason: "Example env file with dummy values, checked 2025-04-02"
    by: CTO
```
