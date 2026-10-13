# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS base
# OpenSSL is required by the Prisma query engine (binaryTarget debian-openssl-3.0.x).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

# --- deps: download packages from the lockfile only (cached until the lockfile changes) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

# --- build: install offline, compile shared + api, assemble a production-only bundle ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm install --offline --frozen-lockfile --filter api...
RUN pnpm --filter @copilot/shared build && pnpm --filter api build
RUN pnpm --filter api deploy --prod /out \
  && cd /out && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/prisma ./prisma
# Seed knowledge base (Markdown), ingested by dist/prisma/seed.js.
COPY --from=build --chown=node:node /repo/apps/api/seed ./seed
USER node
EXPOSE 3001
# Apply migrations, run the idempotent seed (unless SEED_ON_START=false), then start the API.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && if [ \"$SEED_ON_START\" != \"false\" ]; then node dist/prisma/seed.js; fi && exec node dist/src/main.js"]
