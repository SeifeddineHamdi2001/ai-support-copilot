import dns from 'node:dns';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  APICallError,
  embedMany,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  type EmbeddingModel,
  type LanguageModel,
} from 'ai';
import { z } from 'zod';
import {
  EMBEDDING_DIMENSIONS,
  l2normalize,
  LlmProviderError,
  type EmbeddingProvider,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from './llm-provider';

// Prioritise IPv4 resolution so outbound requests do not hang/fail on network interfaces with unrouted IPv6.
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

/**
 * Gemini via Vercel AI SDK 6. Structured output uses `generateText` + `Output.object` with the Zod schema
 * converted to JSON Schema, so Gemini decodes against the schema. The schema is passed WITHOUT a validator:
 * the provider returns the raw JSON and the shared pipeline validates it, exactly as for the mock.
 * SDK retries are off (`maxRetries: 0`) because the pipeline owns retry and timeout policy.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly languageModel: LanguageModel,
    readonly model: string,
  ) {}

  static create(apiKey: string, model: string): GeminiLlmProvider {
    return new GeminiLlmProvider(createGoogleGenerativeAI({ apiKey })(model), model);
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse> {
    try {
      const result = await generateText({
        model: this.languageModel,
        system: req.system,
        prompt: req.prompt,
        // Gemini 3 models reject legacy sampling parameters such as temperature.
        // Keep temperature control for earlier Gemini models that still support it.
        temperature: supportsTemperature(this.model) ? req.temperature : undefined,
        abortSignal: req.signal,
        maxRetries: 0,
        output: Output.object({
          schema: jsonSchema(z.toJSONSchema(req.schema, { io: 'output' }) as object),
          name: req.schemaName,
        }),
      });
      return {
        raw: result.output,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      };
    } catch (err) {
      // The model answered, but not with parseable JSON: hand the text to the pipeline to repair.
      if (NoObjectGeneratedError.isInstance(err)) {
        return {
          raw: err.text ?? null,
          usage: { inputTokens: err.usage?.inputTokens, outputTokens: err.usage?.outputTokens },
        };
      }
      throw toProviderError(err);
    }
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly embeddingModel: EmbeddingModel,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  static create(apiKey: string, model: string, timeoutMs: number): GeminiEmbeddingProvider {
    return new GeminiEmbeddingProvider(
      createGoogleGenerativeAI({ apiKey }).embeddingModel(model),
      model,
      timeoutMs,
    );
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts, 'RETRIEVAL_DOCUMENT');
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.embed([text], 'RETRIEVAL_QUERY');
    return v;
  }

  private async embed(values: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
    if (!values.length) return [];
    try {
      const { embeddings } = await embedMany({
        model: this.embeddingModel,
        values,
        abortSignal: AbortSignal.timeout(this.timeoutMs),
        providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType } },
      });
      // Truncated (Matryoshka) Gemini embeddings are not unit length: normalise for cosine search.
      return embeddings.map((e) => {
        if (e.length !== EMBEDDING_DIMENSIONS) {
          throw new LlmProviderError(
            `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${e.length}`,
            false,
          );
        }
        return l2normalize(e);
      });
    } catch (err) {
      throw err instanceof LlmProviderError ? err : toProviderError(err);
    }
  }
}

/** Maps SDK errors to our provider error. Never copies request bodies or headers (they hold the key). */
export function toProviderError(err: unknown): LlmProviderError {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    const transient = err.isRetryable || status === 429 || (status !== undefined && status >= 500);
    return new LlmProviderError(`Gemini API error: ${firstLine(err.message)}`, transient, status, {
      cause: err,
    });
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new LlmProviderError('Gemini request aborted (timeout)', true, undefined, {
      cause: err,
    });
  }
  // Network failures surface as TypeError("fetch failed") and similar: worth a retry.
  const message = err instanceof Error ? `${err.name}: ${firstLine(err.message)}` : String(err);
  return new LlmProviderError(message, err instanceof TypeError, undefined, { cause: err });
}

const firstLine = (s: string) => s.split('\n')[0].slice(0, 300);

function supportsTemperature(model: string): boolean {
  return !/^gemini-3(?:\.|$)/i.test(model);
}
