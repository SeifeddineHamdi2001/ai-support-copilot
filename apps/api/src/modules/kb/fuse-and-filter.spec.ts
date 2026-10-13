import { defaultMinSimilarity, fuseAndFilter, RRF_K, type Candidate } from './fuse-and-filter';

const c = (
  id: string,
  semanticRank: number | null,
  lexicalRank: number | null,
  similarity: number | null = 0.8,
): Candidate => ({ id, semanticRank, lexicalRank, similarity });

describe('fuseAndFilter', () => {
  it('scores with Reciprocal Rank Fusion (k = 60)', () => {
    const { kept } = fuseAndFilter([c('both', 1, 3), c('vector', 2, null), c('text', null, 1)], {
      topK: 5,
      minSimilarity: 0,
    });

    expect(RRF_K).toBe(60);
    expect(kept.find((r) => r.id === 'both')!.rrf).toBeCloseTo(1 / 61 + 1 / 63, 10);
    expect(kept.find((r) => r.id === 'vector')!.rrf).toBeCloseTo(1 / 62, 10);
    expect(kept.find((r) => r.id === 'text')!.rrf).toBeCloseTo(1 / 61, 10);
  });

  it('ranks a chunk found by both searches above chunks found by only one', () => {
    const { kept } = fuseAndFilter(
      [c('vector-top', 1, null), c('text-top', null, 1), c('both', 5, 5)],
      {
        topK: 5,
        minSimilarity: 0,
      },
    );
    // 2/65 beats 1/61; the two single-list hits tie and fall back to id order.
    expect(kept.map((r) => r.id)).toEqual(['both', 'text-top', 'vector-top']);
  });

  it('breaks RRF ties by similarity, then id (deterministic)', () => {
    const { kept } = fuseAndFilter(
      [c('b', 1, null, 0.5), c('a', null, 1, 0.5), c('c', null, 1, 0.9)],
      { topK: 5, minSimilarity: 0 },
    );
    expect(kept.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the top K before applying the similarity floor', () => {
    const candidates = [
      c('r1', 1, 1, 0.9),
      c('r2', 2, 2, 0.2),
      c('r3', 3, 3, 0.7),
      c('r4', 4, 4, 0.95), // would pass the floor but is outside the top 3
    ];

    const { kept, belowFloor } = fuseAndFilter(candidates, { topK: 3, minSimilarity: 0.5 });

    expect(kept.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(belowFloor.map((r) => r.id)).toEqual(['r2']);
  });

  it('drops a full-text-only match below the floor, and chunks with no similarity', () => {
    const { kept, belowFloor } = fuseAndFilter(
      [c('lexical-only', null, 1, 0.05), c('no-vector', null, 2, null), c('good', 3, null, 0.6)],
      { topK: 5, minSimilarity: 0.15 },
    );
    expect(kept.map((r) => r.id)).toEqual(['good']);
    expect(belowFloor.map((r) => r.id).sort()).toEqual(['lexical-only', 'no-vector']);
  });

  it('accepts a similarity exactly at the floor', () => {
    const { kept } = fuseAndFilter([c('edge', 1, null, 0.55)], { topK: 5, minSimilarity: 0.55 });
    expect(kept).toHaveLength(1);
  });

  it('returns nothing for no candidates', () => {
    expect(fuseAndFilter([], { topK: 5, minSimilarity: 0 })).toEqual({ kept: [], belowFloor: [] });
  });
});

describe('defaultMinSimilarity', () => {
  it('depends on the embedding provider', () => {
    expect(defaultMinSimilarity('gemini')).toBe(0.55);
    expect(defaultMinSimilarity('mock')).toBe(0.15);
    expect(defaultMinSimilarity('unknown')).toBe(0.55);
  });
});
