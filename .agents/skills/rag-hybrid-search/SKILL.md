---
name: rag-hybrid-search
description: Knowledge base and RAG for this repo — Markdown chunking, embeddings, pgvector + Postgres full-text hybrid search with Reciprocal Rank Fusion in Prisma raw SQL, migration safety for vector indexes, grounded draft generation with allow-listed citations, and the "no grounded answer" fallback. Use for anything touching kb_documents, kb_chunks, embeddings, search, drafts, or citations.
---

# RAG with hybrid search (Postgres 16 + pgvector, Prisma 6)

Success criterion: "Generate responses grounded in a knowledge base using RAG, with source citations" and
"responses include relevant sources". Every citation must point to a real chunk that was retrieved.

## Schema notes (Prisma 6)
```prisma
model KbChunk {
  id             String   @id @default(uuid()) @db.Uuid
  documentId     String   @db.Uuid
  document       KbDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  ordinal        Int
  headingPath    String
  content        String
  tokenCount     Int
  embedding      Unsupported("vector(768)")?
  embeddingModel String?
  citations      DraftCitation[]
  @@unique([documentId, ordinal])
}
```
Prisma Client cannot read or write `Unsupported` fields. Write embeddings with
`$executeRaw\`UPDATE "KbChunk" SET embedding = ${vec}::vector WHERE id = ${id}::uuid\`` where `vec` is the
string `'[0.1,0.2,…]'`. Read via `$queryRaw` only.

## Vector/FTS migration (hand-written, separate migration folder)
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX IF NOT EXISTS kb_chunk_embedding_hnsw
  ON "KbChunk" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS kb_chunk_fts_gin
  ON "KbChunk" USING gin (to_tsvector('english', "headingPath" || ' ' || content));
```
Put `CREATE EXTENSION` in the FIRST migration too (before tables), because the `vector(768)` column needs it.

### Migration safety (Prisma may try to drop indexes it doesn't know)
- Always create migrations with `prisma migrate dev --create-only`, read the SQL, and delete any
  `DROP INDEX "kb_chunk_embedding_hnsw"` / `"kb_chunk_fts_gin"` lines before applying.
- Add `scripts/check-migrations.mjs` and root script `check:migrations`: fail if any migration after the
  vector migration contains `DROP INDEX` for those two names. Run it in CI.
- Integration test: after `migrate deploy`, assert both indexes exist in `pg_indexes`.

## Ingestion (`kb/ingestion.service.ts`)
1. Input: title, slug, category, Markdown body (seed docs live in `apps/api/seed/kb/*.md` with front matter).
2. `contentHash = sha256(body)`; if a document with the same slug and hash exists → skip (idempotent).
3. Chunk (pure function `chunkMarkdown(md, opts)`, unit tested):
   - split on headings (#, ##, ###), keep a `headingPath` like `Refund Policy > Annual plans`
   - pack paragraphs up to ~500 tokens (estimate tokens = chars / 4), ~15% overlap between consecutive chunks
     of the same section; never split inside a list item or code block if avoidable
   - embedded text = `${headingPath}\n\n${content}`
4. In ONE transaction: delete old chunks for the document, insert new chunks.
5. Embed in batches of 32 via `EmbeddingProvider.embedDocuments`, write vectors, set `embeddingModel`.
   Document `status`: INDEXED or FAILED (with error); a failed embedding never deletes the old document.
6. `POST /kb/documents/:id/reindex` and a CLI `pnpm kb:reindex` (re-embed everything — needed when the
   embedding provider changes). At query time, refuse chunks whose `embeddingModel` differs from the
   current provider model and log a warning telling the user to reindex.

## Hybrid search (`kb/search.service.ts`)
One SQL query, top-20 from each side, fused with RRF (k = 60):
```sql
WITH semantic AS (
  SELECT id, 1 - (embedding <=> $1::vector) AS similarity,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
  FROM "KbChunk" WHERE embedding IS NOT NULL AND "embeddingModel" = $3
  ORDER BY embedding <=> $1::vector LIMIT 20
), lexical AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(
           to_tsvector('english', "headingPath" || ' ' || content), q) DESC) AS rank
  FROM "KbChunk", websearch_to_tsquery('english', $2) q
  WHERE to_tsvector('english', "headingPath" || ' ' || content) @@ q
  LIMIT 20
), fused AS (
  SELECT COALESCE(s.id, l.id) AS id,
         COALESCE(1.0 / (60 + s.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0) AS rrf
  FROM semantic s FULL OUTER JOIN lexical l ON s.id = l.id
)
SELECT c.id, c."documentId", d.title, d.slug, c."headingPath", c.content, f.rrf,
       1 - (c.embedding <=> $1::vector) AS similarity
FROM fused f JOIN "KbChunk" c ON c.id = f.id JOIN "KbDocument" d ON d.id = c."documentId"
ORDER BY f.rrf DESC LIMIT $4;
```
(Write it with Prisma tagged `$queryRaw` so parameters are bound, never string-concatenated.)
Then apply the floor in code: keep a chunk only if `similarity >= RAG_MIN_SIMILARITY` (env, default 0.55
for Gemini; the hash embedder needs a lower floor such as 0.15 — make the default depend on the provider and
document both). Lexical-only matches still must pass the floor. Return top `RAG_TOP_K` (default 5).
Query text = ticket subject + first 1 000 chars of body. `POST /kb/search {query, k}` exposes this with
scores for debugging and the demo.

RRF fusion and floor filtering should be a pure function too (`fuseAndFilter`) with unit tests.

## Grounded draft (`drafts/draft.service.ts`)
Schema in `packages/shared`:
```ts
export const DraftResponseSchema = z.object({
  answerable: z.boolean(),
  answer: z.string().max(2000),
  citations: z.array(z.object({ chunkId: z.string().uuid(), quote: z.string().max(300) })).max(5),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string().max(200)).max(5),
});
```
Flow:
1. Retrieve. If zero chunks pass the floor → do NOT call the LLM. Save a draft with `answerable=false`,
   a polite holding reply asking for details, outcome VALID, no citations, and mark KB_GAP for escalation.
2. Prompt: sources numbered `[S1]…[S5]` inside `<source id="S1" chunk_id="…" title="…">` tags. Rules: answer
   only from the sources; put `[S#]` after each factual sentence; return the chunk_id for each citation;
   `answerable=false` if the sources do not answer the question; never invent policies, numbers, or links.
3. Run through `structuredCall` (see `llm-structured-output`) with a semantic check:
   every `citations[].chunkId` must be in the retrieved set; if `answerable=true` there must be ≥1 citation.
4. After validation, drop any citation not in the retrieved set (defence in depth). If `answerable=true`
   and no citations remain → downgrade to the holding reply with `answerable=false`.
5. Persist `AiDraftResponse` + `DraftCitation` rows (rank, similarity score, quote, documentId) in one
   transaction, plus a DRAFT_GENERATED ticket event.
6. Drafts are never sent automatically. `PATCH /drafts/:id` approve (optionally with edited content) creates
   a `TicketMessage` from the agent and a DRAFT_APPROVED event; reject records DRAFT_REJECTED.

## Seed knowledge base
10 Markdown docs for fictional "Acme Cloud" with concrete, checkable facts so grounding is visible:
refund policy (14-day window, annual plans prorated, duplicate charges refunded in 5–7 business days),
billing FAQ, password reset & 2FA, SSO setup, outage & status page procedure, data export & GDPR (30-day
request window), plan limits, SLA table (response times per tier), escalation policy, account deletion.

## Tests
- Unit: `chunkMarkdown` (heading path, size cap, overlap, no empty chunks), `fuseAndFilter`, citation
  filtering/downgrade logic.
- Integration (Testcontainers + hash embedder): ingest seed KB → a refund question returns the refund doc
  in the top 3; an off-topic question ("what's the weather in Paris") yields `answerable=false` with no LLM
  call; drafts store citations that join to real chunks; indexes exist.
