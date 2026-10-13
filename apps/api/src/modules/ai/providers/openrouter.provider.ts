import { z } from 'zod';
import {
  LlmProviderError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from './llm-provider';

/** OpenRouter's OpenAI-compatible chat API, using JSON Schema constrained output. */
export class OpenRouterLlmProvider implements LlmProvider {
  readonly name = 'openrouter';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse> {
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: req.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: req.schemaName,
              strict: true,
              schema: z.toJSONSchema(req.schema, { io: 'output' }),
            },
          },
          provider: { require_parameters: true },
          stream: false,
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new LlmProviderError('OpenRouter request aborted (timeout)', true, undefined, {
          cause: error,
        });
      }
      throw new LlmProviderError('OpenRouter network request failed', true, undefined, {
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = openRouterErrorMessage(payload) ?? `HTTP ${response.status}`;
      const transient = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(
        `OpenRouter API error: ${message}`,
        transient,
        response.status,
      );
    }

    const result = payload as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const content = result?.choices?.[0]?.message?.content;
    let raw: unknown = content;
    if (typeof content === 'string') {
      try {
        raw = JSON.parse(content);
      } catch {
        // The shared pipeline gets the original text and can make one schema repair request.
      }
    }

    return {
      raw,
      usage: {
        inputTokens: result?.usage?.prompt_tokens,
        outputTokens: result?.usage?.completion_tokens,
      },
    };
  }
}

function openRouterErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.split('\n')[0].slice(0, 300) : undefined;
}
