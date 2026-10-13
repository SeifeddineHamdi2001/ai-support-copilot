import {
  EMBEDDING_DIMENSIONS,
  l2normalize,
  LlmProviderError,
  type EmbeddingProvider,
} from './llm-provider';

const MAX_BATCH_SIZE = 32;

/** OpenRouter embeddings API, using the configured model's default 768-dimension output. */
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openrouter';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      vectors.push(...(await this.embed(texts.slice(i, i + MAX_BATCH_SIZE))));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector;
  }

  private async embed(input: string[]): Promise<number[][]> {
    if (!input.length) return [];

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({ model: this.model, input }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new LlmProviderError('OpenRouter embedding request timed out', true, undefined, {
          cause: error,
        });
      }
      throw new LlmProviderError('OpenRouter embedding network request failed', true, undefined, {
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = openRouterErrorMessage(payload) ?? `HTTP ${response.status}`;
      throw new LlmProviderError(
        `OpenRouter embedding API error: ${message}`,
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    const result = payload as { data?: Array<{ embedding?: unknown; index?: number }> } | null;
    if (!Array.isArray(result?.data) || result.data.length !== input.length) {
      throw new LlmProviderError('OpenRouter returned an unexpected embedding count', false);
    }

    return [...result.data]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(({ embedding }) => {
        if (
          !Array.isArray(embedding) ||
          embedding.length !== EMBEDDING_DIMENSIONS ||
          !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
        ) {
          throw new LlmProviderError(
            `Expected ${EMBEDDING_DIMENSIONS} embedding dimensions from ${this.model}`,
            false,
          );
        }
        return l2normalize(embedding as number[]);
      });
  }
}

function openRouterErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.split('\n')[0].slice(0, 300) : undefined;
}
