/**
 * Validates process env at boot (ConfigModule `validate`). Fails fast with a readable message instead of
 * failing later on the first request. Every variable here is documented in .env.example.
 */
export type ProviderName = 'mock' | 'gemini';

export interface AppEnv {
  NODE_ENV: 'development' | 'production' | 'test';
  DATABASE_URL: string;
  API_PORT: number;
  CORS_ORIGIN: string;
  LLM_PROVIDER: ProviderName;
  EMBEDDING_PROVIDER: ProviderName;
  GEMINI_API_KEY?: string;
  LLM_MODEL: string;
  EMBEDDING_MODEL: string;
  LLM_TIMEOUT_MS: number;
  RAG_MIN_SIMILARITY?: number;
  RAG_TOP_K: number;
}

const PROVIDERS: ProviderName[] = ['mock', 'gemini'];

function int(raw: unknown, name: string, fallback: number, errors: string[]): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) errors.push(`${name} must be a positive integer`);
  return n;
}

function provider(raw: unknown, name: string, errors: string[]): ProviderName {
  const value = (raw === undefined || raw === '' ? 'mock' : String(raw)) as ProviderName;
  if (!PROVIDERS.includes(value)) errors.push(`${name} must be one of: ${PROVIDERS.join(', ')}`);
  return value;
}

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const errors: string[] = [];

  const DATABASE_URL = String(config.DATABASE_URL ?? '');
  if (!DATABASE_URL.startsWith('postgres')) errors.push('DATABASE_URL must be a postgres:// URL');

  const nodeEnv = String(config.NODE_ENV ?? 'development');
  const NODE_ENV = (
    ['development', 'production', 'test'].includes(nodeEnv) ? nodeEnv : 'development'
  ) as AppEnv['NODE_ENV'];

  const LLM_PROVIDER = provider(config.LLM_PROVIDER, 'LLM_PROVIDER', errors);
  const EMBEDDING_PROVIDER = provider(config.EMBEDDING_PROVIDER, 'EMBEDDING_PROVIDER', errors);
  const GEMINI_API_KEY = config.GEMINI_API_KEY ? String(config.GEMINI_API_KEY) : undefined;
  if ((LLM_PROVIDER === 'gemini' || EMBEDDING_PROVIDER === 'gemini') && !GEMINI_API_KEY) {
    errors.push('GEMINI_API_KEY is required when LLM_PROVIDER or EMBEDDING_PROVIDER is "gemini"');
  }

  let RAG_MIN_SIMILARITY: number | undefined;
  if (config.RAG_MIN_SIMILARITY !== undefined && config.RAG_MIN_SIMILARITY !== '') {
    RAG_MIN_SIMILARITY = Number(config.RAG_MIN_SIMILARITY);
    if (!(RAG_MIN_SIMILARITY >= 0 && RAG_MIN_SIMILARITY <= 1)) {
      errors.push('RAG_MIN_SIMILARITY must be a number between 0 and 1');
    }
  }

  const env: AppEnv = {
    NODE_ENV,
    DATABASE_URL,
    API_PORT: int(config.API_PORT, 'API_PORT', 3001, errors),
    CORS_ORIGIN: String(config.CORS_ORIGIN || 'http://localhost:3000'),
    LLM_PROVIDER,
    EMBEDDING_PROVIDER,
    GEMINI_API_KEY,
    LLM_MODEL: String(config.LLM_MODEL || 'gemini-2.5-flash-lite'),
    EMBEDDING_MODEL: String(config.EMBEDDING_MODEL || 'gemini-embedding-001'),
    LLM_TIMEOUT_MS: int(config.LLM_TIMEOUT_MS, 'LLM_TIMEOUT_MS', 15_000, errors),
    RAG_MIN_SIMILARITY,
    RAG_TOP_K: int(config.RAG_TOP_K, 'RAG_TOP_K', 5, errors),
  };

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return env;
}
