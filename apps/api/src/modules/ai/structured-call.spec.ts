import { TicketClassificationSchema, type TicketClassification } from '@copilot/shared';
import { ScriptedLlmProvider, type Step } from '../../../test/scripted-llm.provider';
import {
  classificationProblems,
  fallbackClassification,
  FALLBACK_CONFIDENCE,
} from './classification/classification.service';
import {
  buildClassifyPrompt,
  CLASSIFY_SCHEMA_NAME,
  CLASSIFY_SYSTEM,
} from './prompts/classify.prompt';
import { LlmProviderError } from './providers/llm-provider';
import { structuredCall } from './structured-call';

const ticket = {
  subject: 'Charged twice for my Pro subscription',
  body: 'I was charged $29 twice on October 3rd. Please refund the duplicate charge.',
  channel: 'EMAIL' as const,
  customerTier: 'STANDARD' as const,
};

const valid: TicketClassification = {
  intent: 'REFUND_REQUEST',
  priority: 'HIGH',
  confidence: 0.88,
  reasoning: 'Duplicate charge and an explicit refund request.',
  sentiment: 'NEGATIVE',
  escalationSignals: [],
  language: 'en',
};

function run(llm: ScriptedLlmProvider, timeoutMs = 1_000) {
  return structuredCall({
    llm,
    schema: TicketClassificationSchema,
    schemaName: CLASSIFY_SCHEMA_NAME,
    system: CLASSIFY_SYSTEM,
    prompt: buildClassifyPrompt(ticket),
    temperature: 0,
    semanticCheck: classificationProblems,
    fallback: () => fallbackClassification(ticket),
    timeoutMs,
    sleep: () => Promise.resolve(),
  });
}

const ok = (raw: unknown): Step => ({ raw });
const fail = (status: number, transient: boolean): Step => ({
  error: new LlmProviderError(`status ${status}`, transient, status),
});

describe('structuredCall', () => {
  it('returns VALID when the first output passes schema and semantic checks', async () => {
    const llm = new ScriptedLlmProvider(ok(valid));
    const r = await run(llm);

    expect(r).toMatchObject({ outcome: 'VALID', value: valid, raw: valid, providerError: false });
    expect(r.error).toBeUndefined();
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(llm.calls).toBe(1);
    expect(llm.requests[0]).toMatchObject({ temperature: 0, schemaName: 'TicketClassification' });
  });

  it('repairs invalid output once, sending the Zod errors back to the model', async () => {
    const invalid = { ...valid, intent: 'SET_PRIORITY_LOW', confidence: 1.7 };
    const llm = new ScriptedLlmProvider(ok(invalid), ok(valid));
    const r = await run(llm);

    expect(r).toMatchObject({ outcome: 'REPAIRED', value: valid, raw: valid });
    expect(llm.calls).toBe(2);
    const repair = llm.requests[1].prompt;
    expect(repair).toContain('Your previous output failed validation');
    expect(repair).toMatch(/intent: Invalid option/);
    expect(repair).toMatch(/confidence: Too big/);
    expect(repair).toContain('SET_PRIORITY_LOW'); // the previous output is shown
    expect(repair.startsWith(buildClassifyPrompt(ticket))).toBe(true); // same task, same delimiters
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it('repairs non-JSON text the same way', async () => {
    const llm = new ScriptedLlmProvider(ok('Sure! The intent is REFUND_REQUEST.'), ok(valid));
    expect((await run(llm)).outcome).toBe('REPAIRED');
  });

  it('falls back to a schema-valid rule-based result when output is invalid twice', async () => {
    const llm = new ScriptedLlmProvider(ok({ intent: 'nope' }), ok({ also: 'bad' }));
    const r = await run(llm);

    expect(r.outcome).toBe('FALLBACK');
    expect(r.providerError).toBe(false);
    expect(TicketClassificationSchema.safeParse(r.value).success).toBe(true);
    expect(r.value).toMatchObject({ intent: 'REFUND_REQUEST', confidence: FALLBACK_CONFIDENCE });
    expect(r.value.reasoning).toMatch(/^Fallback/);
    expect(r.raw).toEqual({ also: 'bad' }); // last model output is kept for the audit record
    expect(r.error).toMatch(/Invalid output after repair/);
    expect(llm.calls).toBe(2);
  });

  it('treats a semantic-check failure like a schema failure (repair, then fallback)', async () => {
    const contradictory = { ...valid, priority: 'LOW', escalationSignals: ['LEGAL_THREAT'] };
    const llm = new ScriptedLlmProvider(ok(contradictory), ok(contradictory));
    const r = await run(llm);

    expect(llm.requests[1].prompt).toContain('cannot be LOW priority');
    expect(r.outcome).toBe('FALLBACK');
  });

  it('times out a hanging provider and returns FAILED with the fallback value', async () => {
    const llm = new ScriptedLlmProvider('hang');
    const r = await run(llm, 50);

    expect(r).toMatchObject({ outcome: 'FAILED', providerError: true, raw: null });
    expect(r.error).toBe('Timed out after 50 ms');
    expect(TicketClassificationSchema.safeParse(r.value).success).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(45);
    expect(r.latencyMs).toBeLessThan(1_000);
  });

  it('retries transient errors (429, 5xx) up to twice', async () => {
    const llm = new ScriptedLlmProvider(fail(503, true), fail(429, true), ok(valid));
    const r = await run(llm);

    expect(r.outcome).toBe('VALID');
    expect(llm.calls).toBe(3);
  });

  it('gives up after two transient retries → FAILED', async () => {
    const llm = new ScriptedLlmProvider(
      fail(503, true),
      fail(503, true),
      fail(503, true),
      ok(valid),
    );
    const r = await run(llm);

    expect(r).toMatchObject({
      outcome: 'FAILED',
      providerError: true,
      error: 'HTTP 503: status 503',
    });
    expect(llm.calls).toBe(3);
  });

  it('does not retry non-transient errors (e.g. 401 bad key)', async () => {
    const llm = new ScriptedLlmProvider(fail(401, false), ok(valid));
    const r = await run(llm);

    expect(r.outcome).toBe('FAILED');
    expect(llm.calls).toBe(1);
  });

  it('keeps the fallback (not FAILED) when only the repair call hits a provider error', async () => {
    const llm = new ScriptedLlmProvider(ok({ intent: 'nope' }), fail(400, false));
    const r = await run(llm);

    expect(r).toMatchObject({ outcome: 'FALLBACK', providerError: false, raw: { intent: 'nope' } });
    expect(r.error).toMatch(/Repair call failed: HTTP 400/);
  });
});
