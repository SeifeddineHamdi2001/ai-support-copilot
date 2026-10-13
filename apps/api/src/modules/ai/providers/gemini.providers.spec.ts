import { TicketClassificationSchema } from '@copilot/shared';
import { APICallError } from 'ai';
import { MockEmbeddingModelV3, MockLanguageModelV3 } from 'ai/test';
import { GeminiEmbeddingProvider, GeminiLlmProvider } from './gemini.providers';
import { LlmProviderError } from './llm-provider';

/** Adapter tests: the AI SDK runs for real, only the model behind it is a mock (no network). */

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

const textModel = (text: string) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'STOP' },
      usage,
      warnings: [],
    }),
  });

const failingModel = (statusCode: number) =>
  new MockLanguageModelV3({
    doGenerate: async () => {
      throw new APICallError({
        message: `upstream ${statusCode}`,
        url: 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
        requestBodyValues: { secret: 'never surfaced' },
        statusCode,
      });
    },
  });

const request = {
  schema: TicketClassificationSchema,
  schemaName: 'TicketClassification',
  system: 'system',
  prompt: 'prompt',
  temperature: 0,
};

describe('GeminiLlmProvider', () => {
  it('sends the schema as JSON response format and returns the parsed JSON unvalidated', async () => {
    const model = textModel('{"intent":"NOT_AN_INTENT","priority":"HIGH"}');
    const llm = new GeminiLlmProvider(model, 'gemini-2.5-flash-lite');

    const res = await llm.generateStructured(request);

    // Validation is the pipeline's job, so invalid-but-JSON output comes back as is.
    expect(res.raw).toEqual({ intent: 'NOT_AN_INTENT', priority: 'HIGH' });
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    const call = model.doGenerateCalls[0];
    expect(call.temperature).toBe(0);
    expect(call.responseFormat).toMatchObject({
      type: 'json',
      name: 'TicketClassification',
      schema: { type: 'object', required: expect.arrayContaining(['intent', 'priority']) },
    });
  });

  it('returns non-JSON text as the raw output so the pipeline can repair it', async () => {
    const llm = new GeminiLlmProvider(textModel('I think this is a refund.'), 'm');
    expect((await llm.generateStructured(request)).raw).toBe('I think this is a refund.');
  });

  it.each([
    [503, true],
    [429, true],
    [401, false],
    [400, false],
  ])(
    'maps HTTP %i to a provider error (transient=%s) without leaking the request',
    async (status, transient) => {
      const llm = new GeminiLlmProvider(failingModel(status), 'm');
      const err = (await llm
        .generateStructured(request)
        .catch((e: unknown) => e)) as LlmProviderError;

      expect(err).toBeInstanceOf(LlmProviderError);
      expect(err.transient).toBe(transient);
      expect(err.statusCode).toBe(status);
      expect(err.message).not.toContain('never surfaced');
    },
  );
});

describe('GeminiEmbeddingProvider', () => {
  it('requests 768 dimensions with the right task type and L2-normalises the vectors', async () => {
    const model = new MockEmbeddingModelV3({
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() =>
          new Array(768).fill(0).map((_, i) => (i === 0 ? 3 : i === 1 ? 4 : 0)),
        ),
        warnings: [],
      }),
    });
    const provider = new GeminiEmbeddingProvider(model, 'gemini-embedding-001', 1_000);

    const [v] = await provider.embedDocuments(['a']);
    expect(v.slice(0, 2)).toEqual([0.6, 0.8]);
    await provider.embedQuery('q');

    expect(model.doEmbedCalls[0].providerOptions).toEqual({
      google: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' },
    });
    expect(model.doEmbedCalls[1].providerOptions?.google).toMatchObject({
      taskType: 'RETRIEVAL_QUERY',
    });
  });

  it('rejects vectors with the wrong dimensionality', async () => {
    const model = new MockEmbeddingModelV3({
      doEmbed: async () => ({ embeddings: [[1, 0, 0]], warnings: [] }),
    });
    const provider = new GeminiEmbeddingProvider(model, 'm', 1_000);
    await expect(provider.embedQuery('q')).rejects.toThrow(/Expected 768 dimensions/);
  });
});

// Optional live check against the real API; skipped unless GEMINI_API_KEY is set.
const live = process.env.GEMINI_API_KEY ? describe : describe.skip;
live('Gemini (live)', () => {
  it('returns a schema-valid classification', async () => {
    const model = process.env.LLM_MODEL || 'gemini-3.6-flash';
    const llm = GeminiLlmProvider.create(process.env.GEMINI_API_KEY!, model);
    const res = await llm.generateStructured({
      ...request,
      system: 'Classify the support ticket. Return JSON matching the schema.',
      prompt:
        '<ticket_body>I was charged twice this month, please refund one charge.</ticket_body>',
    });
    expect(TicketClassificationSchema.safeParse(res.raw).success).toBe(true);
  }, 30_000);
});
