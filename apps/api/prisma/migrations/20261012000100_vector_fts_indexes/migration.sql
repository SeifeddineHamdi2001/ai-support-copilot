-- Hand-written migration: indexes Prisma cannot express in schema.prisma.
-- Prisma does not know about these indexes and may emit DROP INDEX for them in future migrations.
-- Always create migrations with `prisma migrate dev --create-only`, delete any such DROP, and run
-- `pnpm check:migrations` (also enforced in CI).

CREATE EXTENSION IF NOT EXISTS vector;

-- Approximate nearest-neighbour search on chunk embeddings (cosine distance, operator <=>).
CREATE INDEX IF NOT EXISTS kb_chunk_embedding_hnsw
  ON "KbChunk" USING hnsw (embedding vector_cosine_ops);

-- Full-text search as an expression index (no generated column, so Prisma never sees schema drift).
-- Queries must use the exact same expression to hit this index.
CREATE INDEX IF NOT EXISTS kb_chunk_fts_gin
  ON "KbChunk" USING gin (to_tsvector('english', "headingPath" || ' ' || content));
