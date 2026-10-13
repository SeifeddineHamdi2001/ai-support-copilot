-- Drafts keep the model's list of details the customer still has to provide.
-- AlterTable
ALTER TABLE "AiDraftResponse" ADD COLUMN     "missingInformation" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Prisma generated `DROP INDEX "kb_chunk_embedding_hnsw"` here (it does not know the hand-written vector
-- index from *_vector_fts_indexes). Removed on purpose; see docs/DECISIONS.md D3.
