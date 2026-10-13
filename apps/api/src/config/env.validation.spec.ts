import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgresql://copilot:copilot@localhost:5433/copilot' };

describe('validateEnv', () => {
  it('defaults both providers to mock and works without an API key', () => {
    const env = validateEnv(base);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.EMBEDDING_PROVIDER).toBe('mock');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.LLM_TIMEOUT_MS).toBe(15_000);
    expect(env.AI_RATE_LIMIT).toBe(20);
    expect(env.RAG_TOP_K).toBe(5);
  });

  it('fails fast when gemini is selected without GEMINI_API_KEY', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  });

  it('rejects unknown providers and invalid numbers', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ ...base, RAG_MIN_SIMILARITY: '2' })).toThrow(/RAG_MIN_SIMILARITY/);
    expect(() => validateEnv({ ...base, LLM_TIMEOUT_MS: '-1' })).toThrow(/LLM_TIMEOUT_MS/);
    expect(() => validateEnv({ ...base, AI_RATE_LIMIT: '0' })).toThrow(/AI_RATE_LIMIT/);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
