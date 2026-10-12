# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/web/Dockerfile .

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

# --- deps: download packages from the lockfile only ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

# --- build: shared package + Next.js standalone output ---
FROM deps AS build
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --offline --frozen-lockfile --filter web...
RUN pnpm --filter @copilot/shared build && pnpm --filter web build

# --- runtime: only the standalone server and static assets ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
