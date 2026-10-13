import type { AppEnv } from '../../../config/env.validation';
import { GeminiEmbeddingProvider, GeminiLlmProvider } from './gemini.providers';
import { OpenRouterLlmProvider } from './openrouter.provider';
import { HashEmbeddingProvider } from './hash-embedding.provider';
import type { EmbeddingProvider, LlmProvider } from './llm-provider';
import { MockLlmProvider } from './mock-llm.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';

type ProviderEnv = Pick<
  AppEnv,
  | 'LLM_PROVIDER'
  | 'EMBEDDING_PROVIDER'
  | 'GEMINI_API_KEY'
  | 'OPENROUTER_API_KEY'
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
  if (env.LLM_PROVIDER === 'gemini') {
    return GeminiLlmProvider.create(env.GEMINI_API_KEY!, env.LLM_MODEL);
  }
  if (env.LLM_PROVIDER === 'openrouter') {
    return new OpenRouterLlmProvider(env.OPENROUTER_API_KEY!, env.LLM_MODEL);
  }
  return new MockLlmProvider();
}

export function createEmbeddingProvider(env: ProviderEnv): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === 'gemini') {
    return GeminiEmbeddingProvider.create(
      env.GEMINI_API_KEY!,
      env.EMBEDDING_MODEL,
      env.LLM_TIMEOUT_MS,
    );
  }
  if (env.EMBEDDING_PROVIDER === 'openrouter') {
    return new OpenRouterEmbeddingProvider(
      env.OPENROUTER_API_KEY!,
      env.EMBEDDING_MODEL,
      env.LLM_TIMEOUT_MS,
    );
  }
  return new HashEmbeddingProvider();
}
