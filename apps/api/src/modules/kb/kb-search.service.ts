import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiUnavailableError } from '../../common/errors/app-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppEnv } from '../../config/env.validation';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../ai/providers/llm-provider';
import {
  CANDIDATES_PER_SIDE,
  defaultMinSimilarity,
  fuseAndFilter,
  RRF_K,
  type Fused,
} from './fuse-and-filter';
import { toVectorLiteral } from './kb-ingestor';

/** Query text is capped before embedding and full-text parsing. */
export const MAX_QUERY_LENGTH = 2_000;

interface CandidateRow {
  id: string;
  documentId: string;
  title: string;
  slug: string;
  headingPath: string;
  content: string;
  semanticRank: number | null;
  lexicalRank: number | null;
  similarity: number | null;
}

export type SearchHit = Fused<CandidateRow>;

export interface KbSearchResult {
  /** Chunks that passed the similarity floor, best first (the grounding set for drafts). */
  results: SearchHit[];
  /** Top-K chunks rejected by the floor; shown by the search endpoint to explain an empty result. */
  belowFloor: SearchHit[];
  minSimilarity: number;
  topK: number;
  embeddingModel: string;
  /** Chunks embedded with another model (or not at all): invisible to vector search until reindexed. */
  staleChunks: number;
}

/**
 * Hybrid retrieval over KbChunk: cosine top-20 (pgvector HNSW) + full-text top-20 (GIN expression index),
 * fused with Reciprocal Rank Fusion, top K, then a cosine similarity floor (see fuseAndFilter).
 */
@Injectable()
export class KbSearchService {
  private readonly logger = new Logger(KbSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  /**
   * RAG_MIN_SIMILARITY, or the embedding provider's default when unset. ConfigService returns the raw
   * env string for keys validateEnv left undefined (e.g. `RAG_MIN_SIMILARITY=` → ''), so only a number
   * counts as set.
   */
  get minSimilarity(): number {
    const configured: unknown = this.config.get('RAG_MIN_SIMILARITY', { infer: true });
    return typeof configured === 'number' ? configured : defaultMinSimilarity(this.embedder.name);
  }

  async search(query: string, topK?: number): Promise<KbSearchResult> {
    const text = query.slice(0, MAX_QUERY_LENGTH);
    // validateEnv defaults RAG_TOP_K to 5; the fallback only satisfies the ConfigService typing.
    const k = topK ?? this.config.get('RAG_TOP_K', { infer: true }) ?? 5;
    const minSimilarity = this.minSimilarity;

    let vector: number[];
    try {
      vector = await this.embedder.embedQuery(text);
    } catch (err) {
      this.logger.error(`Query embedding failed: ${(err as Error).message}`);
      throw new AiUnavailableError(
        'The embedding provider did not respond, so the knowledge base cannot be searched. Retry later.',
      );
    }

    const [candidates, staleChunks] = await Promise.all([
      this.candidates(toVectorLiteral(vector), text),
      this.staleChunkCount(),
    ]);
    if (staleChunks > 0) {
      this.logger.warn(
        `${staleChunks} KB chunk(s) are not embedded with ${this.embedder.model} and are skipped. ` +
          'Run `pnpm kb:reindex` after switching EMBEDDING_PROVIDER.',
      );
    }

    const { kept, belowFloor } = fuseAndFilter(candidates, { topK: k, minSimilarity, k: RRF_K });
    return {
      results: kept,
      belowFloor,
      minSimilarity,
      topK: k,
      embeddingModel: this.embedder.model,
      staleChunks,
    };
  }

  /**
   * One round trip, all values bound as parameters. Each side keeps its own top 20 with a 1-based rank;
   * the FULL OUTER JOIN returns the union with both ranks and the cosine similarity of every candidate
   * (lexical-only hits included, so the floor applies to them too). Fusion happens in fuseAndFilter.
   *
   * The full-text query ORs the query's lexemes (plainto_tsquery ANDs them, which would almost never
   * match a whole ticket). The to_tsvector expression is identical to the GIN index kb_chunk_fts_gin.
   */
  private candidates(vector: string, text: string): Promise<CandidateRow[]> {
    const model = this.embedder.model;
    return this.prisma.$queryRaw<CandidateRow[]>`
      WITH q AS (
        SELECT ${vector}::vector AS v,
               replace(plainto_tsquery('english', ${text})::text, '&', '|')::tsquery AS ts
      ),
      semantic AS (
        SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> q.v) AS rank
        FROM "KbChunk" c CROSS JOIN q
        WHERE c.embedding IS NOT NULL AND c."embeddingModel" = ${model}
        ORDER BY c.embedding <=> q.v
        LIMIT ${CANDIDATES_PER_SIDE}
      ),
      lexical AS (
        SELECT c.id,
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank_cd(to_tsvector('english', c."headingPath" || ' ' || c.content), q.ts) DESC, c.id
               ) AS rank
        FROM "KbChunk" c CROSS JOIN q
        WHERE c."embeddingModel" = ${model}
          AND to_tsvector('english', c."headingPath" || ' ' || c.content) @@ q.ts
        ORDER BY rank
        LIMIT ${CANDIDATES_PER_SIDE}
      )
      SELECT c.id, c."documentId", d.title, d.slug, c."headingPath", c.content,
             s.rank::int AS "semanticRank", l.rank::int AS "lexicalRank",
             (1 - (c.embedding <=> q.v))::float8 AS similarity
      FROM semantic s
      FULL OUTER JOIN lexical l ON l.id = s.id
      JOIN "KbChunk" c ON c.id = COALESCE(s.id, l.id)
      JOIN "KbDocument" d ON d.id = c."documentId"
      CROSS JOIN q`;
  }

  private staleChunkCount(): Promise<number> {
    return this.prisma.kbChunk.count({
      where: { OR: [{ embeddingModel: null }, { embeddingModel: { not: this.embedder.model } }] },
    });
  }
}
