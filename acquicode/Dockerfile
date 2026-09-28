# One image, four entry points: the web app (default), the worker, migrations, and
# all of them in one container for single-service container platforms.
#   docker run IMAGE                                     → web on :3000
#   docker run IMAGE node dist-node/worker/index.mjs     → worker
#   docker run IMAGE node dist-node/scripts/migrate.mjs  → migrations
#   docker run IMAGE node dist-node/scripts/start.mjs    → migrations, then web + worker
#
# Building behind a TLS-inspecting proxy: copy the proxy's CA certificate(s) into
# deploy/ca/*.pem (git-ignored; certificates are public, not secrets) and pass
# HTTPS_PROXY as a build arg. Plain Dockerfile features only, so any builder works.

# Runtime base: slim by default (git installed with apt). Any Debian-based Node 22
# image that already ships git (e.g. node:22-bookworm) skips the apt step.
ARG RUNTIME_BASE=node:22-bookworm-slim

FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY deploy/ca/ /tmp/extra-ca/
RUN if ls /tmp/extra-ca/*.pem >/dev/null 2>&1; then cat /tmp/extra-ca/*.pem > /tmp/extra-ca.pem; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/cli/package.json packages/cli/
COPY apps/web/package.json apps/web/
RUN if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    pnpm install --frozen-lockfile
COPY packages packages
COPY apps/web apps/web
RUN if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    pnpm run build

FROM ${RUNTIME_BASE} AS runtime
# git: the worker clones and reads history; the sample page builds a demo repository.
COPY deploy/ca/ /tmp/extra-ca/
RUN set -e; \
    if ! command -v git >/dev/null 2>&1; then \
      if ls /tmp/extra-ca/*.pem >/dev/null 2>&1; then \
        cat /tmp/extra-ca/*.pem > /tmp/extra-ca.pem; \
        sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
        echo 'Acquire::https::CAInfo "/tmp/extra-ca.pem";' > /etc/apt/apt.conf.d/99extra-ca; \
      fi; \
      apt-get update; \
      apt-get install -y --no-install-recommends git ca-certificates; \
      rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99extra-ca; \
    fi; \
    rm -rf /tmp/extra-ca /tmp/extra-ca.pem; \
    git --version; \
    useradd --system --uid 10001 --create-home --home-dir /home/acquicode acquicode; \
    mkdir -p /data; chown acquicode:acquicode /data
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/blobs \
    WORK_DIR=/data/work \
    ACQUICODE_RUNNER=/app/apps/web/dist-node/worker/runner.mjs
WORKDIR /app
# Next.js standalone server (traced dependencies only) and its static assets.
COPY --from=build /src/apps/web/.next/standalone ./
COPY --from=build /src/apps/web/.next/static ./apps/web/.next/static
# Worker, analysis runner and migrations are self-contained bundles.
COPY --from=build /src/apps/web/dist-node ./apps/web/dist-node
COPY --from=build /src/apps/web/db ./apps/web/db
WORKDIR /app/apps/web
USER acquicode
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Run with an init process where available (docker --init, compose `init: true`).
CMD ["node", "server.js"]
