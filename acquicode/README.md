# AcquiCode

**Evidence-graded technical diligence for AI-built software.** Know what a buyer will find in your code before they look, and give them a dossier they can verify without seeing the code.

AcquiCode analyses git repositories and produces a signed, reproducible **diligence dossier**:

- who wrote the code, matched against IP-assignment agreements;
- what AI tools were involved and how well that is recorded;
- dependency licenses given the distribution model;
- credentials in code and history;
- supply-chain and build reproducibility;
- maintainability;
- a separate list of everything that could not be established.

Every claim carries a provenance state (OBSERVED, DERIVED, USER_ASSERTED, INFERRED, UNKNOWN, CONFLICTING, …), and the readiness level (READY / REVIEW / BLOCKED) can never be more certain than its evidence.

No language model reads your code. The analysis is deterministic: anyone with the same commits can re-run it and must get the same digest.

## Status

Working software, not yet validated with paying customers:

- a deterministic evidence engine;
- a CLI;
- a hosted web app with a worker;
- PostgreSQL with row-level tenant isolation;
- a production container image, a compose stack and CI.

144 automated tests, including an end-to-end suite against the production build and a database-isolation suite that runs as a non-superuser owner.

What remains uncertain is mostly commercial; see `docs/FOUNDER_REPORT.md` and `docs/WHY_NOT.md`.

## Try it

**Locally, on your own repository** (nothing leaves your machine). The CLI isn't published to npm yet, so build it:

```sh
cd acquicode && corepack enable && pnpm install && pnpm run build
node packages/cli/dist/main.js scan /path/to/repo --out ./acquicode-out
open ./acquicode-out/dossier.html
```

Add `--osv` to check public dependencies against OSV.dev. Add `--sign-key acquicode-signing.key.pem` (from `acquicode keygen`) to sign the dossier. Anyone can then check it with `acquicode verify dossier.json --envelope dossier.dsse.json --key acquicode-signing.pub.pem --reproduce /path/to/repo`.

**The hosted product:**

```sh
./deploy/generate-env.sh > .env
docker compose up -d --build
node deploy/smoke.mjs http://127.0.0.1:3000
```

The sample dossier for a synthetic company, "Meridian Systems", is at `/sample`. The GitHub App, Stripe and S3 are optional; see `docs/DEPLOYMENT.md`.

**Tests:**

```sh
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

## Layout

| Path | What |
|---|---|
| `packages/engine` | The evidence engine: git reading, 13 package managers across 7 ecosystems, licenses, secrets, AI attribution (git-ai, Agent Trace, trailers, blame), diligence rules, invariants, signing, SBOM, diff, HTML |
| `packages/cli` | `acquicode scan / verify / diff / render / keygen / push` |
| `apps/web` | Next.js app, background worker, migrations |
| `deploy/` | Compose helpers, PostgreSQL roles, Caddy, smoke check |
| `docs/` | Everything below |

## Documentation

| Document | Contents |
|---|---|
| [FOUNDER_REPORT.md](docs/FOUNDER_REPORT.md) | The decision, the business, and why this could still fail |
| [PRODUCT.md](docs/PRODUCT.md) | Who it's for, flows, the dossier, pricing |
| [MARKET.md](docs/MARKET.md) | Evidence, labelled FACT / OBSERVATION / ASSUMPTION / SCENARIO |
| [COMPETITORS.md](docs/COMPETITORS.md) | Competitor matrix and attacks |
| [DECISIONS.md](docs/DECISIONS.md) | Every major decision, what attacked it, and what we chose |
| [WHY_NOT.md](docs/WHY_NOT.md) | Directions rejected; kill criteria |
| [ROADMAP.md](docs/ROADMAP.md) | What's next, ordered by risk |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and why |
| [PROVENANCE.md](docs/PROVENANCE.md) | States, evidence classes, invariants |
| [DILIGENCE_MODEL.md](docs/DILIGENCE_MODEL.md) | Questions, readiness, the rule catalogue |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Dossier format and database |
| [API.md](docs/API.md) | CLI, token API, routes, declarations file |
| [SECURITY.md](docs/SECURITY.md) | Controls and proof |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md) | Attackers, mitigations, residual risk |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Image, compose, configuration, GitHub App, database |
| [RUNBOOK.md](docs/RUNBOOK.md) | Operations, key rotation, incidents |
| [TESTING.md](docs/TESTING.md) | Test suites and what they prove |

## What it is not

It is not an AI-code detector, a security dashboard, or legal advice. It reports evidence and its certainty, and turns what matters into questions for management, counsel and engineering.
