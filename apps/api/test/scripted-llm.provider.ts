import {
  LlmProviderError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from '../src/modules/ai/providers/llm-provider';

/** One scripted step: a raw output to return, an error to throw, or `'hang'` (never answers). */
export type Step = { raw: unknown } | { error: Error } | 'hang';

/**
 * Test double for the LLM boundary: replays queued steps in order and records every request, so tests
 * can assert on prompts (e.g. that the repair prompt carries the validation errors).
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-v1';
  readonly requests: StructuredRequest<unknown>[] = [];
  private readonly steps: Step[];

  constructor(...steps: Step[]) {
    this.steps = steps;
  }

  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse> {
    this.requests.push(req as StructuredRequest<unknown>);
    const step = this.steps.shift();
    if (!step) return Promise.reject(new Error('ScriptedLlmProvider: no step left'));
    if (step === 'hang') {
      // Like a real client: only the abort signal ends the wait.
      return new Promise((_resolve, reject) =>
        req.signal?.addEventListener('abort', () => reject(req.signal?.reason), { once: true }),
      );
    }
    if ('error' in step) return Promise.reject(step.error);
    return Promise.resolve({ raw: step.raw, usage: { inputTokens: 100, outputTokens: 20 } });
  }

  get calls(): number {
    return this.requests.length;
  }
}

/** A provider that always fails (non-transient, like a revoked key), so there are no retry delays. */
export class UnavailableLlmProvider implements LlmProvider {
  readonly name = 'unavailable';
  readonly model = 'none';
  calls = 0;

  generateStructured(): Promise<StructuredResponse> {
    this.calls++;
    return Promise.reject(new LlmProviderError('provider unavailable (test)', false, 401));
  }
}
