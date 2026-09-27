#!/bin/sh
# Prints a .env with fresh secrets for docker compose. Review APP_URL and the
# optional integrations before starting:  ./deploy/generate-env.sh > .env
set -eu
rand() { openssl rand -base64 32 | tr -d '\n'; }
pw() { openssl rand -hex 24; }
signing_key=$(openssl genpkey -algorithm ed25519 | awk '{printf "%s\\n", $0}')
cat <<ENV
# Public URL of the app. https is required in production (http only for localhost).
APP_URL=http://localhost:3000

# Database passwords (bundled PostgreSQL).
POSTGRES_PASSWORD=$(pw)
DB_OWNER_PASSWORD=$(pw)
DB_APP_PASSWORD=$(pw)

# Encryption at rest: "kid:base64(32 bytes)". To rotate, prepend a new key and keep the old one until re-encrypted.
DATA_ENCRYPTION_KEYS=k$(date +%Y%m%d):$(rand)

# Ed25519 key that signs platform-attested dossiers. Its public half is served at /.well-known/acquicode-signing-key.pem.
PLATFORM_SIGNING_KEY="${signing_key}"

# Number of reverse proxies in front of the app that append X-Forwarded-For (1 with the bundled Caddy).
TRUST_PROXY=0
LOG_LEVEL=info

# GitHub App (optional; without it, GitHub connections are reported as not configured).
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=

# Stripe (optional).
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Object storage: fs (shared volume) or s3.
STORAGE_DRIVER=fs
S3_BUCKET=
S3_REGION=us-east-1
S3_ENDPOINT=

# Only for the bundled Caddy (docker compose --profile tls up): your domain.
DOMAIN=
ENV
