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

### D8. Dev runs natively, Docker is the production-style path

- **Development** (`pnpm dev`, `pnpm test:int`) runs without Docker against a native PostgreSQL 16 with
  pgvector built from the official source (v0.8.7). Docker Desktop is not usable on every Windows laptop
  (it needs WSL2 and the Windows hypervisor).
- **Production-style** (`docker compose up --build`) uses `pgvector/pgvector:pg16`. The compose database
  is not published to the host: only the API needs it, and leaving it unpublished avoids clashes with a
  native Postgres on 5432/5433.
- **Integration tests** use `TEST_DATABASE_URL` when it is set: the database is dropped and recreated on
  each run, and its name must end in `_test` so a dev database can never be wiped. When it is unset, the
  tests start a throwaway Testcontainers database (the CI path).
- **Timing:** phases 1–7 are built and verified locally without Docker. Docker is used only once local
  development is complete, in Phase 8 (compose stack, multi-stage image builds, CI smoke test, Playwright
  e2e) and the Final check on the VPS. Until then, `compose.yaml` and the Dockerfiles are written but not
  run, and phase checks report Docker items as "deferred to Phase 8" rather than passing.
- **Risk accepted:** Docker-only problems (image builds, Prisma engine in the container, Next standalone
  output, compose healthchecks) surface late. This is mitigated by keeping the Dockerfiles simple and
  leaving Phase 8 time for the Docker check.

### D9. TypeScript 5.9, not 7.x

TypeScript 7 is the npm `latest`, but the NestJS CLI, ts-jest and typescript-eslint target 5.x. TypeScript
is pinned to `~5.9.3` (same policy as other majors: no major upgrade without asking).

### D10. Health check without `@nestjs/terminus`

`GET /api/v1/health` runs `SELECT 1` through Prisma and returns 503 Problem Details when the database is
unreachable. One query does not justify another dependency.

### D11. Tests split by cost

- `pnpm test`: unit tests only (no database, fast).
- `pnpm test:int`: a fresh database (local `TEST_DATABASE_URL` or a Testcontainers `pgvector/pgvector:pg16`
  container, see D8), migrations applied with `migrate deploy` (the same path as production), tests run
  in band.
- `pnpm test:e2e`: Playwright against the compose stack (flows added in Phase 8).

## Phase 2: Ticket core

### D12. One write path for ticket mutations

`PATCH /tickets/:id`, `POST /tickets/:id/status` and `POST /tickets/:id/assign` all go through
`TicketsService.mutate()`, inside one interactive `prisma.$transaction`:

1. Read the ticket: 404 if missing, 409 `TICKET_VERSION_CONFLICT` if the client's `version` is stale.
2. A planner validates the change (state machine, CLOSED guard, assignee check) and returns the field
   changes plus the events to write, or `null` for a no-op.
3. `updateMany WHERE id AND version` bumps the version. If 0 rows match, a concurrent writer won → 409.
4. Then assignment rows and `TicketEvent`s are written in the same transaction.

- **Why:** state and audit cannot diverge, and every endpoint gets locking the same way. The early version
  check gives a precise message ("you sent 1, current is 2"). The guarded `updateMany` closes the race
  between read and write, because under READ COMMITTED the second writer re-checks the WHERE after the
  first commits. An integration test fires two concurrent requests with the same version and asserts that
  exactly one wins and exactly one event is written.
- **No-ops:** reassigning to the current assignee, or setting an already-MANUAL priority to the same
  value, returns the ticket unchanged (no version bump, no event).
- **Rejected:** `SELECT … FOR UPDATE` (needs raw SQL, holds locks longer) and SERIALIZABLE isolation
  (retry handling for no extra guarantee here).

### D13. Problem Details everywhere, from typed errors

- Services throw `AppError` subclasses (`NotFoundError`, `ConflictError`, `VersionConflictError`,
  `InvalidTransitionError`, `UnprocessableError`, `ValidationFailedError`).
- One global `@Catch()` filter maps them, Prisma `P2002/P2025/P2003`, and framework `HttpException`s to
  `application/problem+json` with a stable `errorCode`. Anything else becomes a generic 500, logged with
  its stack and never returned.
- The ValidationPipe's `exceptionFactory` returns per-field `errors[]` (nested paths flattened to `a.b`).
- **Malformed JSON** is reported as 400 `VALIDATION_FAILED`. Nest converts body-parser's `SyntaxError`
  into a `BadRequestException` before filters run and drops the original error, so a separate code would
  depend on matching message text.
- **Status codes:** 400 = request shape, 404 = resource in the URL is missing, 409 = conflicts with the
  current state (stale version, invalid transition, closed ticket, duplicate), 422 = well-formed body
  that references something unusable (unknown customer, inactive assignee, unknown `X-User-Id`).

### D14. Acting agent from `X-User-Id`, validated

- There is no auth (out of scope). A param pipe resolves `X-User-Id` to an active `User`: malformed → 400,
  unknown or inactive → 422. The audit log therefore never records a non-existent actor.
- The header is **required** for agent actions (status, assign, PATCH).
- It is **optional** for `POST /tickets`: without it the `CREATED` event's actor is `SYSTEM`, which
  models tickets arriving from an intake channel (email, web form).

### D15. What PATCH /tickets/:id may change

- Only `priority` and `intent`. Subject and body are the customer's words: they are stored as the first
  `TicketMessage` and are not editable.
- Status and assignee have dedicated endpoints, because they carry rules (state machine, assignment
  history).
- A manual priority sets `prioritySource=MANUAL`, even when the value is unchanged (the agent confirms
  and locks it). Phase 3's AI classification never overrides MANUAL.
- **New event type `INTENT_CHANGED`** (migration `ticket_event_intent_changed`) so manual intent
  corrections are audited like every other change. Prisma generated a `DROP INDEX` for the HNSW index in
  this migration. It was removed by hand, as D3 anticipated, and `pnpm check:migrations` passes.
- POST is not allowed to set priority: new tickets always start at `MEDIUM`/`DEFAULT` until classified.

### D16. Smaller API choices

- `/status` and `/assign` return **200** (they act on an existing resource and create nothing at the URL),
  with the full updated ticket including the new `version` and `allowedTransitions`, so the UI can
  continue without refetching.
- `CLOSED` is terminal: status changes are refused by the state machine (409
  `INVALID_STATUS_TRANSITION`), field and assignment changes by a guard (409 `TICKET_CLOSED`).
- Unassign is `assigneeId: null` on the same endpoint. It closes the open `TicketAssignment` row
  (`unassignedAt`), so the history stays complete.
- List filters accept repeated or comma-separated values (`status=OPEN,IN_PROGRESS`),
  `assigneeId=unassigned` gives the queue, and `q` also matches `#123` ticket numbers. Sort is a
  whitelist (`-priority` puts URGENT first via Postgres enum order), with a unique tie-breaker so
  pagination is stable.
- Customers have no `version` column: they are rarely edited, and only by agents, so last-write-wins is
  acceptable there. A customer with tickets cannot be deleted (409 `CUSTOMER_HAS_TICKETS`) because the
  tickets are kept for the audit trail. The FK is `RESTRICT` as a backstop.
- SLA hours per tier live in `@copilot/shared` (`SLA_HOURS_BY_TIER`), so the seed and the API agree.
