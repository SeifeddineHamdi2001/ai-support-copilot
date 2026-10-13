import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.validation';
import { ClassificationService } from './classification/classification.service';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './providers/llm-provider';
import { createEmbeddingProvider, createLlmProvider } from './providers/provider-factory';

type Config = ConfigService<AppEnv, true>;

const env = (config: Config) => ({
  LLM_PROVIDER: config.get('LLM_PROVIDER', { infer: true }),
  EMBEDDING_PROVIDER: config.get('EMBEDDING_PROVIDER', { infer: true }),
  GEMINI_API_KEY: config.get('GEMINI_API_KEY', { infer: true }),
  LLM_MODEL: config.get('LLM_MODEL', { infer: true }),
  EMBEDDING_MODEL: config.get('EMBEDDING_MODEL', { infer: true }),
  LLM_TIMEOUT_MS: config.get('LLM_TIMEOUT_MS', { infer: true }),
});

/** Binds the env-selected AI implementations (see provider-factory.ts) to their Nest tokens. */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: Config) => createLlmProvider(env(config)),
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: Config) => createEmbeddingProvider(env(config)),
    },
    ClassificationService,
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER, ClassificationService],
})
export class AiModule {}
