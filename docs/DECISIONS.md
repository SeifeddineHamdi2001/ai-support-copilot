# Decisions and trade-offs

Each entry: what was decided, why, and what was rejected. Newest phase at the bottom.

## Phase 1: Scaffold and infrastructure

### D1. pnpm workspace with a compiled shared package
`packages/shared` (`@copilot/shared`) holds the Zod AI output schemas, enum value lists and the ticket
transition table. It is compiled with `tsc` to CommonJS + `.d.ts` in `dist/`, and both apps depend on it
via `workspace:*`.
- **Why:** the NestJS API is CommonJS, and Next.js can consume CJS. A single build output avoids
  dual-package hazards and keeps runtime and Docker setups simple.
- **Rejected:** TS path aliases into the source (breaks in the Nest runtime and Docker without extra
  bundling), and `transpilePackages` in Next only (still leaves the API needing a build).

### D2. Enum values defined twice, kept in sync by a test
Prisma needs enums in `schema.prisma`. Zod schemas and the web app need them in TypeScript.
`apps/api/src/common/enums-sync.spec.ts` fails if the two lists ever differ.
- **Rejected:** generating Zod from Prisma (extra generator dependency, and AI schemas need
  provider-friendly shapes we control by hand).

### D3. Prisma 6 with `Unsupported("vector(768)")` and a hand-written index migration
- **Migration `init`:** generated with `prisma migrate diff --from-empty`, with
  `CREATE EXTENSION IF NOT EXISTS vector` prepended because the `vector(768)` column needs it.
- **Migration `vector_fts_indexes`:** hand-written. It adds an HNSW index (`vector_cosine_ops`) and a GIN
  expression index on `to_tsvector('english', "headingPath" || ' ' || content)`.
- **Why an expression index rather than a generated `tsvector` column:** Prisma would see the generated
  column as drift and try to drop or alter it. The search query must use exactly the same expression.
- **Risk:** Prisma does not know either index and may generate `DROP INDEX` in a later migration.
  `pnpm check:migrations` (`scripts/check-migrations.mjs`) fails if any later migration drops them, and an
  integration test asserts both indexes exist after `migrate deploy`.

### D4. `DraftCitation.chunkId` is nullable (`ON DELETE SET NULL`)
Re-indexing a document replaces its chunks. With a cascade, historical drafts would silently lose their
citations. With `SET NULL`, a citation keeps `documentId`, `quote`, `rank` and `score`, so the audit
trail survives re-indexing.

### D5. Seed: fixed UUIDs, idempotent, tickets created once
- Agents and customers are upserted by fixed id.
- Tickets are created only if their fixed id is missing, so agent work done in the app is never
  overwritten on container restart.
- Each seeded ticket gets a consistent history: an initial customer message, a `CREATED` event, an
  assignment row with an `ASSIGNED` event when assigned, and a `STATUS_CHANGED` event for non-OPEN
  tickets (only statuses reachable from OPEN in one valid transition).
- Tickets start unclassified (`priority=MEDIUM`, `prioritySource=DEFAULT`, `intent=null`) because
  classification is the AI layer's job.

### D6. Migrate and seed when the API container starts
The API container runs `prisma migrate deploy`, then the seed (unless `SEED_ON_START=false`), then the
server, so `docker compose up --build` is the only command needed.
- **Trade-off:** in a multi-replica production deployment, migrations would run as a separate one-off job.

### D7. Mock AI providers by default
`LLM_PROVIDER=mock` and `EMBEDDING_PROVIDER=mock` are the defaults in `.env.example`, `compose.yaml` and
the env validator. The app, seed, tests and CI need no API key. Env validation fails at boot if `gemini`
is selected without `GEMINI_API_KEY`, rather than failing on the first request.

### D8. Postgres published on host port 5433
Developers often have a local Postgres on 5432. Inside the compose network the database is still `db:5432`.

### D9. TypeScript 5.9, not 7.x
TypeScript 7 is the npm `latest`, but the NestJS CLI, ts-jest and typescript-eslint target 5.x. TypeScript
is pinned to `~5.9.3` (same policy as other majors: no major upgrade without asking).

### D10. Health check without `@nestjs/terminus`
`GET /api/v1/health` runs `SELECT 1` through Prisma and returns 503 Problem Details when the database is
unreachable. One query does not justify another dependency.

### D11. Tests split by cost
- `pnpm test`: unit tests only (no Docker, fast).
- `pnpm test:int`: Testcontainers starts one `pgvector/pgvector:pg16` container per run, applies migrations
  with `migrate deploy` (the same path as production), and tests run in band.
- `pnpm test:e2e`: Playwright against the compose stack (flows added in Phase 8).
