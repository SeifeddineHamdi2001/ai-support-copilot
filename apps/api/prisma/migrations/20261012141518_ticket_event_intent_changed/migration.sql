-- Manual intent corrections via PATCH /tickets/:id are audited like every other ticket change.
-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'INTENT_CHANGED';

-- Prisma generated `DROP INDEX "kb_chunk_embedding_hnsw"` here (it does not know the hand-written vector
-- index from *_vector_fts_indexes). Removed on purpose; see docs/DECISIONS.md D3.
