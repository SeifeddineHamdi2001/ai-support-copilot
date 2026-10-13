/**
 * Validates process env at boot (ConfigModule `validate`). Fails fast with a readable message instead of
 * failing later on the first request. Every variable here is documented in .env.example.
 */
export type ProviderName = 'mock' | 'gemini' | 'openrouter';
export type EmbeddingProviderName = 'mock' | 'gemini' | 'openrouter';

export interface AppEnv {
  NODE_ENV: 'development' | 'production' | 'test';
  DATABASE_URL: string;
  API_PORT: number;
  CORS_ORIGIN: string;
  LLM_PROVIDER: ProviderName;
  EMBEDDING_PROVIDER: EmbeddingProviderName;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  LLM_MODEL: string;
  EMBEDDING_MODEL: string;
  LLM_TIMEOUT_MS: number;
  /** Requests per minute per client on routes that call an AI provider. */
  AI_RATE_LIMIT: number;
  RAG_MIN_SIMILARITY?: number;
  RAG_TOP_K: number;
  JWT_SECRET: string;
  SEED_DEFAULT_PASSWORD?: string;
}

const LLM_PROVIDERS: ProviderName[] = ['mock', 'gemini', 'openrouter'];
const EMBEDDING_PROVIDERS: EmbeddingProviderName[] = ['mock', 'gemini', 'openrouter'];

function int(raw: unknown, name: string, fallback: number, errors: string[]): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) errors.push(`${name} must be a positive integer`);
  return n;
}

function provider<T extends string>(
  raw: unknown,
  name: string,
  choices: readonly T[],
  errors: string[],
): T {
  const value = (raw === undefined || raw === '' ? 'mock' : String(raw)) as T;
  if (!choices.includes(value)) errors.push(`${name} must be one of: ${choices.join(', ')}`);
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
  const JWT_SECRET = String(
    config.JWT_SECRET ||
      (NODE_ENV === 'production' ? '' : 'development-only-jwt-secret-change-before-deploy-32bytes'),
  );
  const SEED_DEFAULT_PASSWORD = config.SEED_DEFAULT_PASSWORD
    ? String(config.SEED_DEFAULT_PASSWORD)
    : undefined;
  if (Buffer.byteLength(JWT_SECRET) < 32) errors.push('JWT_SECRET must be at least 32 bytes');
  if (NODE_ENV === 'production' && !SEED_DEFAULT_PASSWORD)
    errors.push('SEED_DEFAULT_PASSWORD is required in production');
  if (NODE_ENV === 'production' && (SEED_DEFAULT_PASSWORD?.length ?? 0) < 12)
    errors.push('SEED_DEFAULT_PASSWORD must be at least 12 characters');

  const LLM_PROVIDER = provider(config.LLM_PROVIDER, 'LLM_PROVIDER', LLM_PROVIDERS, errors);
  const EMBEDDING_PROVIDER = provider(
    config.EMBEDDING_PROVIDER,
    'EMBEDDING_PROVIDER',
    EMBEDDING_PROVIDERS,
    errors,
  );
  const GEMINI_API_KEY = config.GEMINI_API_KEY ? String(config.GEMINI_API_KEY) : undefined;
  const OPENROUTER_API_KEY = config.OPENROUTER_API_KEY
    ? String(config.OPENROUTER_API_KEY)
    : undefined;
  if ((LLM_PROVIDER === 'gemini' || EMBEDDING_PROVIDER === 'gemini') && !GEMINI_API_KEY) {
    errors.push('GEMINI_API_KEY is required when LLM_PROVIDER or EMBEDDING_PROVIDER is "gemini"');
  }
  if (
    (LLM_PROVIDER === 'openrouter' || EMBEDDING_PROVIDER === 'openrouter') &&
    !OPENROUTER_API_KEY
  ) {
    errors.push('OPENROUTER_API_KEY is required when an OpenRouter provider is selected');
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
    OPENROUTER_API_KEY,
    LLM_MODEL: String(
      config.LLM_MODEL || (LLM_PROVIDER === 'openrouter' ? 'openrouter/free' : 'gemini-3.6-flash'),
    ),
    EMBEDDING_MODEL: String(
      config.EMBEDDING_MODEL ||
        (EMBEDDING_PROVIDER === 'openrouter' ? 'baai/bge-base-en-v1.5' : 'gemini-embedding-001'),
    ),
    LLM_TIMEOUT_MS: int(config.LLM_TIMEOUT_MS, 'LLM_TIMEOUT_MS', 15_000, errors),
    AI_RATE_LIMIT: int(config.AI_RATE_LIMIT, 'AI_RATE_LIMIT', 20, errors),
    RAG_MIN_SIMILARITY,
    RAG_TOP_K: int(config.RAG_TOP_K, 'RAG_TOP_K', 5, errors),
    JWT_SECRET,
    SEED_DEFAULT_PASSWORD,
  };

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return env;
}
