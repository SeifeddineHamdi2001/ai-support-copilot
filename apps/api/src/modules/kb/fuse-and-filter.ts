/** Reciprocal Rank Fusion constant (Cormack et al.); dampens the advantage of the very top ranks. */
export const RRF_K = 60;
/** Candidates taken from each side (vector and full-text) before fusion. */
export const CANDIDATES_PER_SIDE = 20;

/** Minimum cosine similarity per embedding provider when RAG_MIN_SIMILARITY is not set. */
export const DEFAULT_MIN_SIMILARITY: Record<string, number> = { gemini: 0.55, mock: 0.15 };

export function defaultMinSimilarity(embeddingProvider: string): number {
  return DEFAULT_MIN_SIMILARITY[embeddingProvider] ?? DEFAULT_MIN_SIMILARITY.gemini;
}

export interface Candidate {
  id: string;
  /** 1-based rank in the vector search, null when only full-text found it. */
  semanticRank: number | null;
  /** 1-based rank in the full-text search, null when only the vector search found it. */
  lexicalRank: number | null;
  /** Cosine similarity to the query (null if the chunk has no embedding for the current model). */
  similarity: number | null;
}

export type Fused<T extends Candidate> = T & { rrf: number };

export interface FuseOptions {
  topK: number;
  minSimilarity: number;
  k?: number;
}

export interface FuseResult<T extends Candidate> {
  /** Top-K by RRF score that also pass the similarity floor: the grounding set. */
  kept: Fused<T>[];
  /** Top-K candidates dropped by the floor (returned by the search endpoint for tuning). */
  belowFloor: Fused<T>[];
}

/**
 * Hybrid ranking: RRF score = Σ 1 / (k + rank) over the lists a chunk appears in, so chunks found by both
 * searches rise to the top. Keep the top K, then drop every chunk under the cosine similarity floor, even
 * one found by full-text search only, so a lexical match alone can never ground an answer.
 */
export function fuseAndFilter<T extends Candidate>(
  candidates: T[],
  options: FuseOptions,
): FuseResult<T> {
  const k = options.k ?? RRF_K;
  const fused = candidates
    .map((c) => ({
      ...c,
      rrf:
        (c.semanticRank ? 1 / (k + c.semanticRank) : 0) +
        (c.lexicalRank ? 1 / (k + c.lexicalRank) : 0),
    }))
    .sort(
      (a, b) =>
        b.rrf - a.rrf || (b.similarity ?? -1) - (a.similarity ?? -1) || a.id.localeCompare(b.id),
    )
    .slice(0, options.topK);

  const passes = (c: Fused<T>) => c.similarity !== null && c.similarity >= options.minSimilarity;
  return { kept: fused.filter(passes), belowFloor: fused.filter((c) => !passes(c)) };
}
