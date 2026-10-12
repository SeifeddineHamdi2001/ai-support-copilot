import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.validation';
import { ClassificationService } from './classification/classification.service';
import { GeminiEmbeddingProvider, GeminiLlmProvider } from './providers/gemini.providers';
import { HashEmbeddingProvider } from './providers/hash-embedding.provider';
import {
  EMBEDDING_PROVIDER,
  LLM_PROVIDER,
  type EmbeddingProvider,
  type LlmProvider,
} from './providers/llm-provider';
import { MockLlmProvider } from './providers/mock-llm.provider';

type Config = ConfigService<AppEnv, true>;

/**
 * Chooses the AI implementations from env (`LLM_PROVIDER`, `EMBEDDING_PROVIDER`, default `mock`).
 * env.validation.ts already refused to boot if gemini is selected without GEMINI_API_KEY.
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: Config): LlmProvider =>
        config.get('LLM_PROVIDER', { infer: true }) === 'gemini'
          ? GeminiLlmProvider.create(
              config.get('GEMINI_API_KEY', { infer: true })!,
              config.get('LLM_MODEL', { infer: true }),
            )
          : new MockLlmProvider(),
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: Config): EmbeddingProvider =>
        config.get('EMBEDDING_PROVIDER', { infer: true }) === 'gemini'
          ? GeminiEmbeddingProvider.create(
              config.get('GEMINI_API_KEY', { infer: true })!,
              config.get('EMBEDDING_MODEL', { infer: true }),
              config.get('LLM_TIMEOUT_MS', { infer: true }),
            )
          : new HashEmbeddingProvider(),
    },
    ClassificationService,
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER, ClassificationService],
})
export class AiModule {}
