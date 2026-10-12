import { embedText, HashEmbeddingProvider } from './hash-embedding.provider';

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (v: number[]) => Math.sqrt(dot(v, v));

describe('HashEmbeddingProvider', () => {
  const provider = new HashEmbeddingProvider();

  it('returns deterministic, unit-length 768-dim vectors', async () => {
    const [a, b] = await provider.embedDocuments(['Refund policy', 'Refund policy']);
    expect(a).toHaveLength(768);
    expect(a).toEqual(b);
    expect(norm(a)).toBeCloseTo(1, 10);
    expect(await provider.embedQuery('Refund policy')).toEqual(a);
  });

  it('scores texts that share words above unrelated texts', () => {
    const query = embedText('How do I get a refund for a duplicate charge?');
    const related = embedText('Refunds: duplicate charges are refunded within 5 business days.');
    const unrelated = embedText(
      'Enable two-factor authentication from the security settings page.',
    );
    expect(dot(query, related)).toBeGreaterThan(0.3);
    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated) + 0.2);
  });

  it('returns a unit vector for empty text', () => {
    expect(norm(embedText(''))).toBeCloseTo(1, 10);
  });
});
