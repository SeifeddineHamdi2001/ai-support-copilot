import { TicketClassificationSchema } from '@copilot/shared';
import { EMBEDDING_DIMENSIONS, LlmProviderError } from './llm-provider';
import { OpenRouterLlmProvider } from './openrouter.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';

describe('OpenRouterLlmProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const request = {
    schema: TicketClassificationSchema,
    schemaName: 'TicketClassification',
    system: 'system prompt',
    prompt: 'user prompt',
    temperature: 0,
  };

  it('sends JSON Schema response format to OpenRouter and parses JSON content', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = jest.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ intent: 'BILLING', priority: 'HIGH' }),
              },
            },
          ],
          usage: { prompt_tokens: 45, completion_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new OpenRouterLlmProvider('sk-test-key', 'openai/gpt-4o-mini');
    const res = await provider.generateStructured(request);

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({
      Authorization: 'Bearer sk-test-key',
      'Content-Type': 'application/json',
    });

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.model).toBe('openai/gpt-4o-mini');
    expect(parsedBody.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
    expect(parsedBody.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'TicketClassification',
        strict: true,
      },
    });

    expect(res.raw).toEqual({ intent: 'BILLING', priority: 'HIGH' });
    expect(res.usage).toEqual({ inputTokens: 45, outputTokens: 15 });
  });

  it('returns raw text unchanged when LLM responds with non-JSON output', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Plain text unparsed response' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new OpenRouterLlmProvider('sk-test-key', 'openai/gpt-4o-mini');
    const res = await provider.generateStructured(request);

    expect(res.raw).toBe('Plain text unparsed response');
  });

  it.each([
    [503, true],
    [429, true],
    [401, false],
    [400, false],
  ])('maps HTTP %i to LlmProviderError with transient=%s', async (status, transient) => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: `Rate limit or server error: ${status}` },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new OpenRouterLlmProvider('sk-test-key', 'openai/gpt-4o-mini');
    const error = (await provider.generateStructured(request).catch((e: unknown) => e)) as LlmProviderError;

    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error.statusCode).toBe(status);
    expect(error.transient).toBe(transient);
    expect(error.message).toContain(`Rate limit or server error: ${status}`);
  });

  it('maps AbortError or TimeoutError to a transient LlmProviderError', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    globalThis.fetch = jest.fn().mockRejectedValue(abortErr);

    const provider = new OpenRouterLlmProvider('sk-test-key', 'openai/gpt-4o-mini');
    const error = (await provider.generateStructured(request).catch((e: unknown) => e)) as LlmProviderError;

    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error.transient).toBe(true);
    expect(error.message).toContain('aborted');
  });

  it('maps generic network failure to a transient LlmProviderError', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const provider = new OpenRouterLlmProvider('sk-test-key', 'openai/gpt-4o-mini');
    const error = (await provider.generateStructured(request).catch((e: unknown) => e)) as LlmProviderError;

    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error.transient).toBe(true);
    expect(error.message).toContain('network request failed');
  });
});

describe('OpenRouterEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function make768Vector(v0 = 3, v1 = 4): number[] {
    const vec = new Array(EMBEDDING_DIMENSIONS).fill(0);
    vec[0] = v0;
    vec[1] = v1;
    return vec;
  }

  it('returns empty array when embedding empty input list', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy;

    const provider = new OpenRouterEmbeddingProvider('sk-test-key', 'model-embed', 5000);
    const result = await provider.embedDocuments([]);

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('embeds a single query and L2-normalizes the vector', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: make768Vector(3, 4) }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new OpenRouterEmbeddingProvider('sk-test-key', 'model-embed', 5000);
    const vector = await provider.embedQuery('test query');

    expect(vector).toHaveLength(768);
    // sqrt(3^2 + 4^2) = 5 -> normalized: 3/5 = 0.6, 4/5 = 0.8
    expect(vector[0]).toBeCloseTo(0.6, 5);
    expect(vector[1]).toBeCloseTo(0.8, 5);
    const norm = Math.hypot(...vector);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('batches requests when input exceeds MAX_BATCH_SIZE (32)', async () => {
    const texts = Array.from({ length: 35 }, (_, i) => `doc text ${i}`);
    const fetchCalls: Array<{ body: string }> = [];

    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      fetchCalls.push({ body: init?.body as string });
      const parsed = JSON.parse(init?.body as string);
      const inputLength = (parsed.input as string[]).length;
      return new Response(
        JSON.stringify({
          data: Array.from({ length: inputLength }, (_, i) => ({
            index: i,
            embedding: make768Vector(1, 0),
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new OpenRouterEmbeddingProvider('sk-test-key', 'model-embed', 5000);
    const result = await provider.embedDocuments(texts);

    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[0].body).input).toHaveLength(32);
    expect(JSON.parse(fetchCalls[1].body).input).toHaveLength(3);
    expect(result).toHaveLength(35);
  });

  it('throws non-transient error when upstream returns wrong dimensions', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [1, 2, 3] }], // 3 dims instead of 768
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new OpenRouterEmbeddingProvider('sk-test-key', 'model-embed', 5000);
    const error = (await provider.embedQuery('bad dimensions').catch((e: unknown) => e)) as LlmProviderError;

    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error.transient).toBe(false);
    expect(error.message).toContain(`Expected ${EMBEDDING_DIMENSIONS} embedding dimensions`);
  });

  it('throws transient error on 429 / 500 status from OpenRouter', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'Too many requests' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new OpenRouterEmbeddingProvider('sk-test-key', 'model-embed', 5000);
    const error = (await provider.embedQuery('query').catch((e: unknown) => e)) as LlmProviderError;

    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error.statusCode).toBe(429);
    expect(error.transient).toBe(true);
  });
});
