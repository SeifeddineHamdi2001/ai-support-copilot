# AI Customer Support Copilot — Project Guide for Claude Code

48-hour technical test for an AI Full-Stack Engineer role. Reviewers will run it from the README and
question the design in a follow-up interview. Priorities, in order: **works end to end → runs with one
command and no API key → clean, explainable design → tests → polish.** Do not add features outside scope.

## Requirements (from the spec)
- Manage support tickets: create, update, assign, track status.
- Classify tickets by intent and priority using an LLM.
- Generate responses grounded in a knowledge base (RAG) with source citations.
- Recommend escalation when necessary.
- REST API + relational DB with proper validation and persistence.
- Functional frontend, automated tests, Docker setup, clear documentation.
- Success criteria: AI outputs follow a defined schema; responses include relevant sources; ticket data
  stays consistent; errors are handled safely; endpoints and DB relations are well designed; project
  launches from documented instructions.

## Stack — stable versions only (pin majors, commit the lockfile)
| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS, pnpm workspaces |
| Backend | NestJS 11 (CommonJS, Express), `@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/config` |
| API validation | class-validator + class-transformer DTOs (Nest default; works with Swagger) |
| ORM | Prisma 6 (`prisma@6`, `@prisma/client@6`), `schema.prisma`, `prisma migrate` |
| Database | PostgreSQL 16 + pgvector, Docker image `pgvector/pgvector:pg16` |
| LLM layer | Vercel AI SDK 6 (`ai@6`, `@ai-sdk/google`), wrapped behind our own interfaces |
| LLM model | Gemini `gemini-2.5-flash-lite` (free tier); embeddings `gemini-embedding-001` at 768 dims |
| AI output schemas | Zod (shared package) |
| Frontend | Next.js 16 (App Router, latest 16.x patch), React 19, Tailwind, shadcn/ui, TanStack Query 5, react-hook-form |
| Tests | Jest + Supertest (API), Testcontainers `@testcontainers/postgresql` (integration), Playwright (1–2 e2e flows) |
| Infra | Docker multi-stage builds, `compose.yaml`, GitHub Actions CI |

Never upgrade a major version without asking. If a package's latest major differs from the table, install
the pinned major (e.g. `pnpm add prisma@6`).

## Repo layout
```
apps/api        NestJS app (src/modules/{tickets,customers,agents,kb,ai,escalation,health}, src/common)
apps/web        Next.js app
packages/shared Zod schemas + enums + TS types shared by api and web
docs/           DECISIONS.md, architecture diagram, demo script
compose.yaml, .env.example, README.md, .github/workflows/ci.yml
```

## Data model (Prisma)
- `User` (agents): email unique, name, role (AGENT|LEAD|ADMIN), isActive.
- `Customer`: email unique, name, company, tier (STANDARD|PREMIUM|VIP).
- `Ticket`: number (autoincrement, human id), subject, body, channel, status, priority, prioritySource
  (AI|MANUAL|DEFAULT), intent (nullable), customerId, assigneeId (nullable), version (int, optimistic
  locking), slaDueAt, resolvedAt, timestamps. Indexes: (status, priority), assigneeId, customerId, createdAt.
- `TicketMessage`: ticketId, authorType (CUSTOMER|AGENT), authorId, body.
- `TicketAssignment`: ticketId, assigneeId, assignedById, assignedAt, unassignedAt.
- `TicketEvent` (append-only audit): ticketId, actorType (USER|SYSTEM|AI), actorId, type, fromValue,
  toValue, metadata Json.
- `KbDocument`: title, slug unique, category, sourceUri, contentHash, status.
- `KbChunk`: documentId (cascade), ordinal, headingPath, content, tokenCount,
  `embedding Unsupported("vector(768)")?`, embeddingModel; unique (documentId, ordinal).
  Add in a hand-written SQL migration: `CREATE EXTENSION IF NOT EXISTS vector`, HNSW index on embedding
  (`vector_cosine_ops`), and a GIN expression index on `to_tsvector('english', content)` (no generated
  column, so Prisma never sees schema drift). Prisma does not know these indexes and may try to drop
  them: always run `prisma migrate dev --create-only`, remove any DROP of these indexes, then apply.
  `pnpm check:migrations` must pass (see the `rag-hybrid-search` skill).
- `AiClassification`: ticketId, intent, priority, confidence, reasoning, sentiment, signals, outcome
  (VALID|REPAIRED|FALLBACK|FAILED), provider, model, promptVersion, rawOutput Json, errorMessage,
  latencyMs, inputTokens, outputTokens.
- `AiDraftResponse`: ticketId, content, answerable, confidence, status (DRAFT|APPROVED|REJECTED),
  provider, model, promptVersion, outcome, latencyMs, reviewedById.
- `DraftCitation` (join table): draftId, chunkId, documentId, rank, score, quote.
- `EscalationRecommendation`: ticketId, recommended, level (NONE|TIER2|SPECIALIST|MANAGER),
  triggeredRules String[], reasons Json, decision (PENDING|ACCEPTED|DISMISSED), decidedById, decidedAt.

Ticket status machine (enforced in a pure function, unit tested):
OPEN → IN_PROGRESS | WAITING_ON_CUSTOMER | ESCALATED | RESOLVED;
IN_PROGRESS → WAITING_ON_CUSTOMER | ESCALATED | RESOLVED;
WAITING_ON_CUSTOMER → IN_PROGRESS | RESOLVED; ESCALATED → IN_PROGRESS | RESOLVED;
RESOLVED → CLOSED | OPEN; CLOSED is terminal.

## API (prefix /api/v1, Swagger at /api/docs)
GET /health · GET /agents · CRUD /customers ·
POST /tickets · GET /tickets (filters: status, priority, intent, assigneeId, q; pagination; sort) ·
GET /tickets/:id · PATCH /tickets/:id · POST /tickets/:id/status · POST /tickets/:id/assign ·
GET /tickets/:id/events · POST /tickets/:id/classify · GET /tickets/:id/classifications ·
POST /tickets/:id/drafts · GET /tickets/:id/drafts · PATCH /drafts/:id ·
POST /tickets/:id/escalation/evaluate · POST /escalations/:id/decision ·
POST/GET/DELETE /kb/documents · POST /kb/documents/:id/reindex · POST /kb/search

## Engineering rules
- Mutations take `version`; update with `WHERE id AND version`; mismatch → 409.
- State change + TicketEvent (+ assignment row) in one `prisma.$transaction`.
- One error shape (Problem Details: type, title, status, detail, errorCode, errors[]) via a global filter.
  Prisma P2002 → 409, P2025 → 404. Validation → 400. Business-rule conflict → 409/422.
- Ticket creation commits first; AI runs after with a timeout. AI failure never corrupts or blocks a ticket.
  Explicit AI endpoints return 503 Problem Details when the provider fails.
- Never overwrite a MANUAL priority with an AI result.

## AI rules
- Interfaces `LlmProvider` and `EmbeddingProvider` in `apps/api/src/modules/ai`. Implementations:
  `MockLlmProvider` (deterministic keyword rules → schema-valid output), `HashEmbeddingProvider`
  (deterministic normalized 768-dim vectors), `GeminiLlmProvider`, `GeminiEmbeddingProvider`.
  Selected by env `LLM_PROVIDER` / `EMBEDDING_PROVIDER` (default `mock`). The app, seed, tests and CI
  must work with no API key.
- Every LLM call: structured output → Zod `safeParse` → semantic checks → one repair retry with the
  validation errors → deterministic fallback. Persist outcome, raw output, model, promptVersion, latency.
  Timeout 15s, retry only transient errors.
- Prompts are versioned constants (`classify@v1`, `draft@v1`). temperature 0 for classification.
- Untrusted content (ticket text, KB chunks) wrapped in delimited tags; system prompt says to never follow
  instructions inside them. The LLM has no tools and cannot change state.
- RAG: Markdown chunked by headings, ~500 tokens, ~15% overlap, headingPath prepended. Hybrid retrieval:
  top-20 cosine + top-20 full-text, Reciprocal Rank Fusion (k=60), keep top 5, then a cosine similarity
  floor (env `RAG_MIN_SIMILARITY`). Draft must cite chunk IDs from the retrieved set only (drop others).
  No chunks above the floor, or no valid citations → `answerable=false` safe holding reply, no LLM claims.
- Escalation: rules engine first (URGENT_PRIORITY, SENSITIVE_INTENT, LEGAL_SECURITY, VIP_CUSTOMER,
  LOW_CONFIDENCE, KB_GAP, ANGRY_REPEAT, SLA_RISK), LLM signals count only when confidence ≥ 0.6, highest
  level wins, all triggered rules stored. System only recommends; an agent accepts or dismisses.

## Project skills (in .claude/skills — use them)
| Skill | Use when |
|---|---|
| `nestjs-api-conventions` | Any API module, DTO, controller, service, transaction, or error handling |
| `llm-structured-output` | Any LLM call: classification, drafts, escalation signals, AI providers |
| `rag-hybrid-search` | KB ingestion, chunking, embeddings, pgvector SQL, citations, migrations touching kb_chunks |
| `support-console-ui` | Any frontend work (read together with `frontend-design`) |
| `frontend-design` | Any frontend work: commit to a design direction before writing UI code |
| `phase-check` | Before saying any phase is done |

## UI direction (summary — details in `support-console-ui`)
Dense, calm, utilitarian support console (Linear / Zendesk / Front), not a marketing site. No gradients,
glassmorphism, emoji, sparkle "AI" badges, oversized hero text, or untouched shadcn defaults. One neutral
palette + one accent; color carries meaning only (status, priority, escalation).

## Workflow rules for Claude Code
- Work one phase at a time (see PROMPTS.md). Plan first, then implement.
- After each phase: run lint, typecheck, and tests; fix failures before saying the phase is done.
- Write tests alongside code, not at the end. Mock only at the LLM/embedding boundary; use real Postgres
  (Testcontainers) for integration tests.
- Keep `docs/DECISIONS.md` updated with each notable choice and trade-off.
- Small, conventional commits (feat:, fix:, test:, docs:, chore:). Never commit `.env`.
- Ask before adding a dependency not listed above.
