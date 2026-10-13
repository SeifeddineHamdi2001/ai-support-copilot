import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS, l2normalize, type EmbeddingProvider } from './llm-provider';

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from has have how i if in is it its my of on or our so that the this to was we what when which will with you your'.split(
    ' ',
  ),
);

/**
 * Default embedder (`EMBEDDING_PROVIDER=mock`): feature hashing. Each token (and each pair of adjacent
 * tokens) is hashed into one of 768 buckets with a hash-derived sign, weighted by 1 + log(tf), and the
 * vector is L2-normalised. Deterministic, no network, and texts sharing words get a real cosine
 * similarity, so retrieval tests are meaningful.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model = 'hash-768-v1';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => embedText(t)));
  }

  embedQuery(text: string): Promise<number[]> {
    return Promise.resolve(embedText(text));
  }
}

export function embedText(text: string): number[] {
  const tokens = tokenize(text);
  const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]} ${t}`)];
  const counts = new Map<string, number>();
  for (const f of features) counts.set(f, (counts.get(f) ?? 0) + 1);

  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [feature, tf] of counts) {
    const h = createHash('md5').update(feature).digest();
    const bucket = h.readUInt32LE(0) % EMBEDDING_DIMENSIONS;
    const sign = h[4] & 1 ? 1 : -1;
    // Bigrams count half: they sharpen matches without drowning single-word overlap.
    const weight = (1 + Math.log(tf)) * (feature.includes(' ') ? 0.5 : 1);
    v[bucket] += sign * weight;
  }
  // An empty text still needs a unit vector (cosine distance is undefined for the zero vector).
  if (counts.size === 0) v[0] = 1;
  return l2normalize(v);
}

/** Lowercased, stop-word-free, lightly stemmed word tokens (also used by the mock draft writer). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}

/** Tiny suffix stripper so "refunds"/"refunded"/"refund" share a bucket. */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
