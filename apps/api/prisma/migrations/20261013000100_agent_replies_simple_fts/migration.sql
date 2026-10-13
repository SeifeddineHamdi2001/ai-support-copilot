ALTER TYPE "TicketEventType" ADD VALUE 'AGENT_REPLIED';

CREATE INDEX IF NOT EXISTS kb_chunk_fts_simple_gin
  ON "KbChunk" USING gin (to_tsvector('simple', "headingPath" || ' ' || content));
