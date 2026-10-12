import type { z } from 'zod';

/** Nest injection tokens. The implementation is chosen from env in ai.module.ts. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export const EMBEDDING_DIMENSIONS = 768;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface StructuredRequest<T> {
  schema: z.ZodType<T>;
  /** Short identifier sent to providers that support named outputs, e.g. "TicketClassification". */
  schemaName: string;
  system: string;
  prompt: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface StructuredResponse {
  /**
   * The model's output as parsed JSON, or the raw text when it was not JSON. Never validated here: the
   * structured-call pipeline validates every provider's output the same way.
   */
  raw: unknown;
  usage?: TokenUsage;
}

/** A text model that returns JSON for a schema. It has no tools and cannot change application state. */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: typeof EMBEDDING_DIMENSIONS;
  /** Unit-length vectors, one per input text, for indexing. */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Unit-length vector for a search query. */
  embedQuery(text: string): Promise<number[]>;
}

/**
 * Thrown by providers for failures talking to the model (HTTP, network, timeout), as opposed to a model
 * that answered with bad output. `transient` failures are retried by the pipeline.
 */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly statusCode?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmProviderError';
  }
}

/** Scales a vector to unit length (cosine similarity then equals the dot product). */
export function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}
