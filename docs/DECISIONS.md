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
- The header (or JWT session) is **required** for agent actions (status, assign, PATCH).
- For `POST /tickets`, role permissions require `MANAGER` or `ADMIN` (`@Roles('MANAGER', 'ADMIN')`, `@ActingAgentRequired()`). Agents cannot create tickets, and unassigned ticket creation by agents is prohibited to maintain assignment integrity.

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

## Phase 3: AI layer and classification

### D17. One pipeline for every LLM call, validation outside the provider

`ai/structured-call.ts` runs: provider call → Zod `safeParse` → semantic checks → one repair call (same
prompt + the previous output + the validation errors) → deterministic fallback. Providers return the raw,
unvalidated output, so the mock and Gemini are held to exactly the same checks.

- **Outcomes:** `VALID`, `REPAIRED`, `FALLBACK` (the model answered but never validly), `FAILED` (the
  provider could not be reached). The pipeline never throws for model or provider problems; the caller
  decides what an outcome means.
- **Semantic checks** catch what the schema cannot: lowercase ISO language code, no LOW priority with a
  legal or security signal, no URGENT feature request, no duplicate signals.
- **Timeout:** each request (initial, repair) has a total budget of `LLM_TIMEOUT_MS` (15 s) that covers its
  transient retries (429/5xx/network, up to 2, exponential backoff with jitter). A timeout is not retried
  because the budget is spent. Worst case is about 2 × 15 s. Non-transient errors (401, 400) are not retried.
- **Rejected:** a separate timeout per retry (up to 3 × 15 s per request) and SDK-level retries
  (`maxRetries: 0` on Gemini, so retry policy lives in one place and is unit tested).

### D18. AI SDK 6: `generateText` + `Output.object` with an unvalidated JSON Schema

`generateObject` is deprecated in AI SDK 6. Gemini receives the Zod schema converted to JSON Schema
(`z.toJSONSchema` → `jsonSchema()` with no validator), so it decodes against the schema, but the SDK does
not validate. The pipeline does. Non-JSON answers (`NoObjectGeneratedError`) are returned as raw text, so
they go through the repair step instead of failing. `@ai-sdk/google` is pinned to 3.x, the line that
targets `ai@6` (its `latest` tag, 4.x, targets the next SDK major).

### D19. What a classification run may change

One `AiClassification` row is stored for every run, whatever the outcome (raw output, error, provider,
model, `classify@v1`, latency, tokens). Applying it to the ticket is a pure planner
(`tickets/apply-classification.ts`) executed through the existing `mutate()` write path with actor `AI`:

- `VALID`/`REPAIRED`: sets intent and priority (`prioritySource=AI`), one event per change plus
  `AI_CLASSIFIED` (with `classificationId`).
- **MANUAL priority is never overwritten.** A manually corrected intent (an `INTENT_CHANGED` event by a
  USER) is kept the same way. The skipped fields are listed in the event's `kept` metadata. This is derived
  from the audit log, so no `intentSource` column was added.
- `FALLBACK`: only an `AI_CLASSIFIED` event. Keyword rules are not trusted enough to set fields.
- `FAILED`: nothing changes, not even an event. The ticket keeps `MEDIUM`/`DEFAULT`.
- `mutate(version: null)` is the system-writer mode: it uses the version just read, so the guarded update
  still loses to a concurrent agent (retried once). Event-only plans do not bump `version`, so an AI run
  never makes an agent's next edit fail with 409.
- Events written in one transaction now get 1 ms-apart timestamps. They used to share `now()` and sort by
  random UUID, so the timeline order of multi-event changes was arbitrary.

### D20. Auto-classification runs synchronously after the commit

`POST /tickets` commits the ticket, then classifies it inside the same request, and returns the classified
ticket. Any AI error is caught and logged, and the committed ticket is returned anyway.

- **Why:** with `gemini-2.5-flash-lite` this takes about a second, the UI gets the result without polling,
  and tests are deterministic.
- **Trade-off:** when the provider is down, ticket creation can take up to the 15 s timeout. In production
  this would be an outbox/queue job (a `ticket.created` event consumed by a worker). That adds
  infrastructure (Redis or a polling worker) that is out of scope here.
- `POST /tickets/:id/classify` is the explicit path. `FAILED` → 503 `AI_PROVIDER_UNAVAILABLE` (the run is
  still recorded, the ticket is untouched). Closed tickets → 409 `TICKET_CLOSED`.

### D21. Mock provider = keyword rules shared with the fallback

`MockLlmProvider` reads the ticket back from the same delimited prompt a real model gets, and returns
`classifyByKeywords()`. The same function, with confidence capped at 0.3, is the pipeline's fallback, so a
fallback always sends the ticket to a human (LOW_CONFIDENCE in Phase 6). Text that looks like instructions
to the assistant ("ignore previous instructions", "set priority to") is ignored: the ticket is never
lowered below MEDIUM, and its confidence drops to 0.5.

`HashEmbeddingProvider`: feature hashing of stemmed unigrams and half-weight bigrams into 768 signed
buckets, L2-normalised. It is deterministic and gives real lexical similarity, so Phase 5 retrieval tests
are meaningful without a key.

### D22. Prompt-injection defences in the classifier

- Customer text goes inside `<ticket_subject>`/`<ticket_body>`. Tags and control characters are stripped,
  remaining `& < >` are escaped and the length is capped (`prompts/untrusted.ts`), so the text cannot
  close the tags.
- Metadata we control (channel, tier) goes in attributes, outside the untrusted text.
- The system prompt says never to follow instructions inside the tags or reveal the prompt. One few-shot
  example shows an ignored instruction.
- The model has no tools. Its output is enum-constrained, and the server alone decides what to apply.

### D23. Testing the AI boundary

Only the LLM boundary is faked: `ScriptedLlmProvider` (queued outputs, errors or hangs) and
`UnavailableLlmProvider`. The Gemini adapters are tested with the AI SDK's own `MockLanguageModelV3` /
`MockEmbeddingModelV3`, so the SDK code path runs and no network is used. A live Gemini test runs only when
`GEMINI_API_KEY` is set. The Phase 2 ticket suite now boots with an unavailable LLM: it keeps those tests
about ticket rules, and it proves creation never depends on the AI. The AI path has its own integration
suite (`ticket-classification.int-spec.ts`).

## Phase 4: Thin UI slice

### D24. Client-rendered console on TanStack Query, no server data fetching

The console pages are client components that call the REST API directly. TanStack Query owns the cache.
Each mutation writes the returned ticket into the cache and invalidates the ticket's events and the list.

- **Why:** the API is the product surface reviewers will test, and the UI uses exactly that surface (no
  Next.js BFF or server actions duplicating it). The agent's identity is in the browser (see D25), so
  server rendering would have nothing to personalise.
- **Rejected:** RSC fetching with server actions. It adds a second network path, `NEXT_PUBLIC_API_URL` vs.
  an internal URL in Docker, and cache coordination, with no benefit for an internal tool behind a login.
- Inbox filters live in the URL (`?tab=…&priority=…&q=…`), so a filtered view survives reloads and can be shared.

### D25. Agent switcher instead of auth

There is no authentication in scope. The sidebar switcher lists the seeded agents (`GET /agents`). The choice is
kept in `localStorage` and sent as `X-User-Id` on every mutation, which the API validates (D14). This makes
the audit trail show real actors and lets a reviewer act as two agents to see a 409.

### D26. Optimistic-locking UX

Every mutation sends the `version` of the ticket on screen. A 409 `TICKET_VERSION_CONFLICT` does not
overwrite the cache or retry automatically. A notice says "This ticket was updated by someone else" with a
Reload button, so the agent sees the new state before re-applying the change. Silently retrying with the
new version would turn locking into last-write-wins. Other errors show as toasts or inline Problem Details
(`title` + `detail`). A 503 from classify reads "AI service unavailable. The ticket is unchanged."

### D27. UI dependencies and visual system

Added: `@tanstack/react-query@5`, `react-hook-form@7` + `@hookform/resolvers@5` (the new-ticket form uses
the shared `CreateTicketFormSchema`, which now has readable messages), `zod@4` (same major as shared),
`sonner@2` (toasts). shadcn primitives were added with the CLI and restyled through tokens in `globals.css`.
The tokens are warm stone neutrals, one deep-teal accent, 6/8 px radii, no panel shadows and no backdrop blur.
Status uses a distinct glyph shape per state, so it does not rely on color alone. Priority is a dot plus a label.
The Next.js dev badge is disabled because it covered the agent switcher.

### D28. E2E against local dev servers until Phase 8

`e2e/tests/ticket-triage.spec.ts` covers create → classified → status change → timeline, plus the 409
notice and reload. It runs against whatever stack is up (`E2E_BASE_URL`/`E2E_API_URL`). Locally that is
`pnpm dev`; Phase 8 runs the same specs against the compose stack in CI.

## Phase 5: Knowledge base and grounded drafts

### D29. Ingestion: chunk by heading, embed first, then swap in one transaction

`kb/chunk-markdown.ts` (pure, unit tested) splits on `#`/`##`/`###` and records a heading path such as
`Refund Policy > Annual plans`. It packs whole blocks (paragraph, list, table, fenced code) up to ~500
tokens (chars / 4) and repeats ~15% of the previous chunk (whole trailing paragraphs, else trailing
sentences) at the start of the next chunk of the same section. Oversized blocks are split per list item,
then per sentence. The embedded and full-text indexed text is `headingPath + content`.

`KbIngestor` is a plain class, so the seed, `pnpm kb:reindex` and the API share it.

- **Idempotent:** `contentHash = sha256(title, category, body)`. The same slug and hash with every chunk
  on the current `embeddingModel` → `unchanged`. The same hash on another model → re-embed only.
- **Failure-safe:** all vectors are computed (batches of 32) **before** the transaction. The transaction
  then upserts the document, deletes its old chunks, inserts the new ones and writes vectors with bound
  `$executeRaw … ::vector`. If embedding fails, the old chunks stay searchable and the document is
  marked `FAILED` with the error. Through the API that is a 503.
- Re-indexing deletes chunks. `DraftCitation.chunkId` is then set to NULL by the FK, and the citation
  keeps `documentId` and its quote for the audit trail.
- Front matter is parsed by a 15-line `key: value` reader. That is all the seed docs need, so no
  `gray-matter` dependency.

### D30. Hybrid search: one SQL round trip, fusion in TypeScript

`KbSearchService` sends one `$queryRaw`: the cosine top 20 (HNSW, only chunks on the current
`embeddingModel`) FULL OUTER JOIN the full-text top 20 (same expression as the GIN index). Each candidate
comes back with both ranks and its cosine similarity. `fuseAndFilter` (pure, unit tested) applies RRF with
k = 60, keeps the top `RAG_TOP_K` (5), then drops anything below the similarity floor. The floor also
applies to full-text-only hits, so a keyword match alone can never ground an answer.

- **OR full-text query:** `plainto_tsquery` / `websearch_to_tsquery` AND every term. A ticket subject plus
  a 1,000-character body would almost never match. The query's lexemes are OR-ed instead
  (`replace(plainto_tsquery(…)::text, '&', '|')::tsquery`) and `ts_rank_cd` orders them.
- **Fusion in TS rather than SQL:** the same round trip, but RRF, tie-breaking and the floor are unit
  tested, and the search endpoint can show what the floor dropped (`belowFloor`).
- **Floor:** `RAG_MIN_SIMILARITY`, else 0.15 for the hash embedder and 0.55 for Gemini. 0.15 was measured
  on the seed tickets. The on-topic tickets' best chunk scores 0.23–0.64. The weather ticket, the
  prompt-injection ticket and the dark-mode request (not in the KB) top out at 0.07–0.13.
- **Stale vectors:** chunks on another embedding model are skipped. The search result reports
  `staleChunks` and logs a warning to run `pnpm kb:reindex`.
- Fixed while testing: Nest's `ConfigService` returns the raw env string for keys `validateEnv` leaves
  `undefined`. `RAG_MIN_SIMILARITY=` therefore came back as `''`, and `'' ?? default` disabled the floor.
  Only a number now counts as configured.

### D31. Grounded drafts: retrieval gate, verified citations, holding reply

`DraftsService.generate`:

1. **Retrieve** with the subject plus the first 1,000 characters of the body. If nothing passes the floor,
   **the LLM is not called**. The draft is the fixed holding reply (`answerable=false`, no citations,
   provider `system`, model `retrieval-gate`). It makes no factual claim, so it is safe to send.
2. **Prompt `draft@v1`** (temperature 0.2). The ticket goes in the escaped data tags. Sources go in
   `<source id="S1" chunk_id="…" title="…" section="…">`, with attributes escaped too.
3. **Semantic check** (failures trigger the repair call): every `chunkId` is one of the retrieved chunks;
   each quote appears verbatim in its chunk (ignoring case, whitespace and Markdown emphasis); every
   `[S#]` refers to a cited source; and an answerable draft has at least one citation and one marker.
4. **`groundDraft` gate** runs on repaired output too, as defence in depth. It drops unknown and duplicate
   citations, blanks unverifiable quotes, and removes markers of uncited sources. An answerable draft with
   no surviving citation, a model answer of `answerable=false`, `FALLBACK`, and `FAILED` all become the
   holding reply, so the model's own wording never reaches the customer without grounding.
5. **One transaction:** `AiDraftResponse` + `DraftCitation` rows (`rank` = the S number, `score` = cosine
   similarity, quote, documentId) + a `DRAFT_GENERATED` event (actor AI, `holdingReason` in metadata).
   The ticket row does not change, so its `version` is not bumped and nobody gets a spurious 409.

- **Provider down:** the FAILED run is recorded (same as classification) and the endpoint returns 503. If
  the _embedding_ call fails, nothing is recorded, because no draft run happened, and the response is a 503.
- **Review:** `PATCH /drafts/:id {status, content?}`. A guarded `updateMany … WHERE status = 'DRAFT'`, the
  agent `TicketMessage` (approve only, edited text allowed) and the `DRAFT_APPROVED` / `DRAFT_REJECTED`
  event are written in one transaction. A second review gets 409 `DRAFT_ALREADY_REVIEWED`. Drafts are
  never sent automatically.
- **Schema change:** `AiDraftResponse.missingInformation String[]`. Prisma's generated migration again
  contained `DROP INDEX "kb_chunk_embedding_hnsw"`, which was removed by hand (D3), and
  `check:migrations` passes.

### D32. Mock drafts are extractive

`MockLlmProvider` answers `draft@v1` by parsing the sources out of the prompt. It scores each sentence or
list item by distinct stemmed words shared with the ticket (the hash embedder's tokenizer), minus 0.5 per
retrieval rank. It keeps up to 4 sentences with at least 2 shared words (at most 2 per source), and cites
the real chunk IDs with the sentence as the quote. With no qualifying sentence it returns
`answerable=false`. Its output passes the same grounding checks as Gemini's.

**Known limitation:** extraction can pick a sentence that makes little sense out of context, such as an
item from a "not refundable" list. That is acceptable for a no-key demo, because an agent reviews every
draft. With `LLM_PROVIDER=gemini`, the model writes the prose.

## Phase 6: Escalation and hardening

### D33. Escalation is a pure rules engine; the model is one gated input

`escalation/escalation-rules.ts` is a pure function with table-driven tests. It takes the ticket, the
latest classification, the latest draft, the customer's recent ticket count and whether an agent has
replied, and returns every triggered rule with a level, a reason and a source (`RULE` or `LLM`). The
highest level wins.

| Rule             | Fires when                                                                      | Level      |
| ---------------- | ------------------------------------------------------------------------------- | ---------- |
| URGENT_PRIORITY  | priority is URGENT                                                              | TIER2      |
| SENSITIVE_INTENT | intent is REFUND_REQUEST or CANCELLATION                                        | TIER2      |
| LEGAL_SECURITY   | legal threat or safety                                                          | MANAGER    |
|                  | breach or chargeback                                                            | SPECIALIST |
| VIP_CUSTOMER     | VIP and (HIGH/URGENT, or negative/angry sentiment)                              | TIER2      |
| LOW_CONFIDENCE   | classification confidence < 0.6, or FALLBACK                                    | TIER2      |
| KB_GAP           | latest draft not answerable (not counting provider failures)                    | TIER2      |
| ANGRY_REPEAT     | angry, and another ticket from the customer in 7 days or says they wrote before | MANAGER    |
| SLA_RISK         | OPEN/IN_PROGRESS, no agent reply, < 25 % of the tier's SLA window left          | TIER2      |

- **Model gating:** the model's sentiment and signals count only when the run is VALID/REPAIRED **and**
  confidence ≥ 0.6. FAILED runs never count as "low confidence": that means the provider was down, which
  is a different problem.
- **Keyword floor:** LEGAL_SECURITY also matches the ticket text with the same regexes the mock
  classifier uses (`detectSignals`). A lawyer or breach ticket is escalated even when the model misses the
  signal or is down. That is why auto-evaluation on ticket creation runs whatever the AI outcome.
- **Rejected:** asking the LLM for an escalation decision. Rules are explainable, testable and cannot be
  talked out of escalating by a prompt-injection ticket.

### D34. When to store a recommendation, and who decides

- Evaluation runs automatically after classification (on create and on `POST /classify`) and after
  drafting, plus on demand with `POST /tickets/:id/escalation/evaluate`. Only tickets that can move to
  ESCALATED (OPEN, IN_PROGRESS) are evaluated. The explicit endpoint returns 409
  `ESCALATION_NOT_APPLICABLE` for other statuses.
- **Dedup:** a new `EscalationRecommendation` row is written only when the level or rule set differs from
  the ticket's latest row. The first evaluation is always stored, even NONE, so the panel can show "checked,
  nothing to escalate". Re-evaluating after every AI step does not pile up identical rows, and a dismissed
  recommendation is not raised again until something new fires.
- Only a positive recommendation writes an `ESCALATION_RECOMMENDED` event (actor SYSTEM). The ticket row
  is untouched, so its version does not change and open editors get no spurious 409.
- **Decision:** `POST /escalations/:id/decision {decision, version?, note?}` with `X-User-Id`. Only the
  ticket's latest, positive, pending recommendation can be decided (409 `ESCALATION_SUPERSEDED`,
  `ESCALATION_NOT_RECOMMENDED`, `ESCALATION_ALREADY_DECIDED`). ACCEPTED requires the ticket version. It
  validates the transition with the state machine, then a guarded update of the row
  (`WHERE decision = 'PENDING'`), the `WHERE id AND version` ticket update, and the
  `ESCALATION_ACCEPTED` + `STATUS_CHANGED` events run in one transaction. A stale version rolls everything
  back, including the decision. DISMISSED changes no ticket field.
- `GET /tickets/:id/escalations` was added (not in the original endpoint list) because the UI needs it.
- The decision endpoint returns `{ escalation, ticket: {id, status, version} }` instead of the full ticket
  detail. That keeps the escalation module independent of the tickets module, which already depends on it.

### D35. Hardening

- **Rate limit:** `@nestjs/throttler`, applied only through `@AiRateLimited()` on the routes that call a
  provider: classify, drafts, KB search, KB create and reindex. The limit is `AI_RATE_LIMIT` per minute
  per client IP (default 20). Over the limit the API returns 429 `RATE_LIMITED` Problem Details with
  `Retry-After`. `POST /tickets` is not throttled even though it auto-classifies, so an intake channel is
  never refused. Known gap: a flood of new tickets still costs one classification each.
- **Input sanitising:** `@CleanText()` replaces `@Trim()` on every free-text DTO field. It strips HTML
  tags and comments (line-breaking tags become newlines), control characters except `\n`/`\t`, bidi
  overrides and zero-width spaces, then trims. It runs before validation, so `<p></p>` fails `MinLength`.
  KB article content keeps HTML (Markdown may contain it) but loses control characters. Prompt building
  still escapes everything inside the data tags (`untrusted()`), as defence in depth.
- **Size limits:** the existing `@MaxLength` on every string, plus an explicit 1 MB JSON body cap.
  Fixed: body-parser's "entity too large" error used to fall through to a 500. It is now
  413 `PAYLOAD_TOO_LARGE`.
- **Structured AI logs:** `logAiRun` writes one JSON line per run
  (`event: "ai_run"`, task/prompt version, ticketId, provider, model, outcome, latency, tokens, error,
  task metrics) and the escalation service logs `event: "escalation_evaluated"`. Only ids and metrics are
  logged, never ticket text. Prompts and outputs stay in the database rows.
- **Provider down:** covered by integration tests for classify and drafts: 503 Problem Details, the run is
  recorded, and the ticket row, its events and its escalations are unchanged.

## Phase 7: Full UI

### D36. Draft panel: markers as chips, sources as footnotes

- The draft sits under the conversation, where the agent will read it as a reply. AI text is rendered as
  React text nodes only. `splitDraft()` turns each `[S#]` that matches a returned citation into a small
  chip, attached to the preceding word in a `nowrap` span so a chip never wraps onto a line by itself.
  Unknown markers stay as literal text.
- Clicking a chip selects and expands the matching row in the Sources list (document title, section
  path, verified quote, cosine similarity), which shows the full chunk and links to it in the knowledge
  base (`/kb?doc=&chunk=` opens the document with that chunk highlighted). One click goes from a claim to
  its evidence.
- `answerable=false` shows a neutral "No grounded answer. Review manually." notice with the missing-
  information list above the holding reply. The footer then says "No sources cited" instead of a
  confidence of 0.00. The holding reply can still be edited and approved.
- **Markers are stripped server-side on approval.** The draft row keeps its `[S#]` markers, so an
  approved or rejected draft still lines up with its sources. The `TicketMessage` the customer receives
  goes through `stripCitationMarkers()`. Doing this in the API, not the UI, means every client gets the
  same customer-facing text. The edit box keeps the markers visible for reference and says they are
  removed.
- Only the latest draft is shown, with a count of earlier ones. Browsing old drafts is not in scope.

### D37. Escalation: banner for the decision, side panel for the state

- A pending, positive recommendation shows as a banner above the conversation: level, then one row per
  triggered rule with its reason, its own level and "(model signal)" when it relied on an LLM signal.
  Accept/Dismiss sit in the banner footer. It only appears when the ticket can still move to ESCALATED.
- The side panel always shows the latest state (not evaluated, nothing triggered, pending, accepted or
  dismissed by whom) and has Evaluate / Re-evaluate, so every escalation endpoint is usable without
  Swagger.
- Accepting sends the ticket version. A 409 uses the same "updated by someone else, Reload" notice as
  the properties panel. Other 409s (superseded, already decided) refetch the list and show a toast.
- Classification and draft generation invalidate the escalation query, because both re-run the rules
  server-side.

### D38. Knowledge base page

- A documents table (title + slug, category, chunks, status, updated) with per-row Reindex and a two-step
  Delete (the confirmation expires after 4 s). Row actions stay muted until the row is hovered or
  focused. Clicking a title opens a chunk viewer showing what the retriever sees: heading path, token
  count and text.
- Add document: title, category (suggests existing ones), optional slug, Markdown body. A `.md` file can
  be loaded into the body and its first `# ` heading fills an empty title. Client validation mirrors the
  DTO, and server field errors land on their fields.
- The search tester calls `POST /kb/search` (the same retrieval drafts use) and shows, per hit, cosine
  similarity, RRF score and both source ranks, plus the floor, top-K, embedding model and the hits
  dropped by the floor (collapsed). It is a mutation, not a query, since each run costs an embedding
  call. `/` focuses it.

## Phase 8: Tests, CI, Docker check

### D39. CI: checks first, then the production path

- `.github/workflows/ci.yml` has two jobs. `checks`: install, lint, typecheck, `check:migrations`, unit
  tests, integration tests. With no `TEST_DATABASE_URL`, the integration global setup starts
  `pgvector/pgvector:pg16` with Testcontainers (GitHub runners have Docker).
- `docker` (after `checks`): `cp .env.example .env` like the README quick start, `docker compose build`,
  `docker compose up -d --wait`, a smoke test of `/api/v1/health` (`"db":"up"`) and the web app, then
  the Playwright suite against the stack. On failure it uploads compose logs and Playwright traces. No
  secret is used anywhere: both AI providers run as mocks.
- The job raises `AI_RATE_LIMIT` to 200, because the specs plus Playwright's CI retry can exceed 20 AI
  calls a minute from one client. The limit itself is covered by an integration test.
- Rejected: running e2e against `pnpm dev` in CI. The point of the job is to exercise the images that
  ship.

### D40. E2E specs share one stack, so they run serially and own their data

- `workers: 1`: every spec writes to the same database. A flaky 409 showed why. The stale-version test
  patched "the first ticket in the inbox", which could be the ticket another worker was escalating at
  the same moment. That test now creates its own ticket, and no spec mutates a ticket it did not create.
- `full-loop.spec.ts` covers the whole loop in one UI flow: create ticket → classification → grounded
  draft with citations → accept escalation. A refund request is enough, because `SENSITIVE_INTENT`
  recommends TIER2. The older specs cover each feature in more depth.

### D41. Deleting a KB document drops its citations; editing keeps them

- Editing a document replaces its chunks, so `DraftCitation.chunkId` becomes NULL (FK `SET NULL`). The
  citation keeps `documentId` and the quote. Deleting the document cascades to its citations. The draft
  survives, and an approved reply already lives in the conversation. Both cases are now integration
  tested.
- Rejected: a nullable `documentId` that keeps orphan citations after deletion. It needs a migration and
  gives the UI nothing to link to.

## Phase 9: Docs & demo

### D42. Comprehensive README and pinned 5-minute demo walkthrough

`README.md` acts as the single source of truth for repository evaluation, providing verifiable commands,
architecture diagrams, and AI safety breakdowns. `docs/DEMO_SCRIPT.md` provides a timed 5-minute walkthrough
pinned to exact seeded database records.

- **Why:** reviewers will clone and run the project strictly from documented instructions. Having every command
  verified (`pnpm lint`, `pnpm typecheck`, `pnpm check:migrations`, `pnpm test`, `pnpm test:int`, `pnpm test:e2e`)
  guarantees zero setup friction. Pinning the demo script to deterministic seeded records (e.g. VIP lawyer outage,
  Paris weather off-topic holding reply, prompt injection defense) ensures reproducible evaluations.
- **Rejected:** scattered documentation across subfolders (reviewers shouldn't need to hunt for setup, API endpoints,
  or architectural rationale); and a demo script with ad-hoc steps (risks unpredictable timings or ungrounded flows).

### D43. JWT authentication with assignment-scoped agent access

- **Decision:** Authenticate API requests with an eight-hour HS256 access token. The database remains the source of the user's active state and role on every request. Agents can read and work tickets assigned to them; managers and admins can read the full queue and assign tickets. Only managers and admins decide escalations. Acceptance routes the ticket to the active manager in the same transaction as its status, assignment history, and audit events.
- **Seed behavior:** Keep exactly one active demo account per role. The former second agent is deactivated and tickets assigned to that account are reassigned to the seeded agent with an audit event. Passwords are stored as scrypt hashes; production seeding requires `SEED_DEFAULT_PASSWORD` and API startup requires a 32-byte `JWT_SECRET`.
- **Why:** Role checks alone do not protect ticket records. Scoping ticket detail and related routes to the assignee closes direct-ID access as well as list access, while a manager queue supports assignment and escalation review.
- **Rejected:** trusting a client-selected user ID (the previous `X-User-Id` model), and checking access only in the web UI.
