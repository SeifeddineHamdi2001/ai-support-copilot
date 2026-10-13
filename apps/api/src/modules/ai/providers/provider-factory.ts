import type { AppEnv } from '../../../config/env.validation';
import { GeminiEmbeddingProvider, GeminiLlmProvider } from './gemini.providers';
import { HashEmbeddingProvider } from './hash-embedding.provider';
import type { EmbeddingProvider, LlmProvider } from './llm-provider';
import { MockLlmProvider } from './mock-llm.provider';

type ProviderEnv = Pick<
  AppEnv,
  | 'LLM_PROVIDER'
  | 'EMBEDDING_PROVIDER'
  | 'GEMINI_API_KEY'
  | 'LLM_MODEL'
  | 'EMBEDDING_MODEL'
  | 'LLM_TIMEOUT_MS'
>;

/**
 * Chooses the AI implementations from env (`LLM_PROVIDER`, `EMBEDDING_PROVIDER`, default `mock`). Used by
 * the Nest module and by scripts (seed, reindex) so both always embed with the same provider.
 * validateEnv() already refused gemini without GEMINI_API_KEY.
 */
export function createLlmProvider(env: ProviderEnv): LlmProvider {
  return env.LLM_PROVIDER === 'gemini'
    ? GeminiLlmProvider.create(env.GEMINI_API_KEY!, env.LLM_MODEL)
    : new MockLlmProvider();
}

export function createEmbeddingProvider(env: ProviderEnv): EmbeddingProvider {
  return env.EMBEDDING_PROVIDER === 'gemini'
    ? GeminiEmbeddingProvider.create(env.GEMINI_API_KEY!, env.EMBEDDING_MODEL, env.LLM_TIMEOUT_MS)
    : new HashEmbeddingProvider();
}
