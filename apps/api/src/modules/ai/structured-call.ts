import type { AiOutcome } from '@copilot/shared';
import type { z } from 'zod';
import { LlmProviderError, type LlmProvider, type TokenUsage } from './providers/llm-provider';

export const DEFAULT_LLM_TIMEOUT_MS = 15_000;
/** Retries of one request after a transient provider error (429, 5xx, network). */
const MAX_TRANSIENT_RETRIES = 2;
const BACKOFF_BASE_MS = 250;
const MAX_ERROR_LENGTH = 1_000;

export interface StructuredCallOptions<T> {
  llm: LlmProvider;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  prompt: string;
  temperature?: number;
  /** Rules the schema cannot express. Returns human-readable problems; [] means the value is fine. */
  semanticCheck?: (value: T) => string[];
  /** Deterministic, schema-valid result used when the model output stays invalid or the model is down. */
  fallback: () => T;
  /** Time budget for each request (initial and repair), including its transient retries. */
  timeoutMs?: number;
  /** Injected in tests to skip real backoff delays. */
  sleep?: (ms: number) => Promise<void>;
}

export interface StructuredCallResult<T> {
  value: T;
  /**
   * VALID: first answer passed. REPAIRED: second answer passed after feedback. FALLBACK: the model
   * answered but never validly, so `value` is the fallback. FAILED: the provider could not be reached
   * (timeout, outage, auth); `value` is the fallback and `providerError` is true.
   */
  outcome: AiOutcome;
  /** Last output received from the model (unvalidated), for the audit record. */
  raw: unknown;
  error?: string;
  providerError: boolean;
  latencyMs: number;
  usage: TokenUsage;
}

/**
 * Every LLM call in the app goes through here:
 * provider call (timeout, transient retries) → Zod safeParse → semantic check → one repair call with the
 * validation errors → deterministic fallback. It never throws for model or provider problems: callers get
 * an outcome and decide (background work keeps the fallback, explicit endpoints turn FAILED into a 503).
 */
export async function structuredCall<T>(
  opts: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  const started = performance.now();
  const usage: TokenUsage = {};
  const done = (
    r: Omit<StructuredCallResult<T>, 'latencyMs' | 'usage'>,
  ): StructuredCallResult<T> => ({
    ...r,
    error: r.error && truncate(r.error),
    latencyMs: Math.round(performance.now() - started),
    usage,
  });

  const first = await request(opts, opts.prompt, usage);
  if (!first.ok) {
    return done({
      value: opts.fallback(),
      outcome: 'FAILED',
      raw: null,
      error: first.error,
      providerError: true,
    });
  }
  const firstProblems = validate(opts, first.raw);
  if (firstProblems.ok) {
    return done({
      value: firstProblems.value,
      outcome: 'VALID',
      raw: first.raw,
      providerError: false,
    });
  }

  const repair = await request(
    opts,
    repairPrompt(opts.prompt, first.raw, firstProblems.problems),
    usage,
  );
  if (!repair.ok) {
    // The model was reachable but its first answer was unusable: keep the deterministic result.
    return done({
      value: opts.fallback(),
      outcome: 'FALLBACK',
      raw: first.raw,
      error: `Invalid output: ${firstProblems.problems.join('; ')}. Repair call failed: ${repair.error}`,
      providerError: false,
    });
  }
  const second = validate(opts, repair.raw);
  if (second.ok) {
    return done({
      value: second.value,
      outcome: 'REPAIRED',
      raw: repair.raw,
      providerError: false,
    });
  }
  return done({
    value: opts.fallback(),
    outcome: 'FALLBACK',
    raw: repair.raw,
    error: `Invalid output after repair: ${second.problems.join('; ')}`,
    providerError: false,
  });
}

type Attempt = { ok: true; raw: unknown } | { ok: false; error: string };

/** One logical request with a total time budget; transient failures are retried inside that budget. */
async function request<T>(
  opts: StructuredCallOptions<T>,
  prompt: string,
  usage: TokenUsage,
): Promise<Attempt> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await raceAbort(
        opts.llm.generateStructured({
          schema: opts.schema,
          schemaName: opts.schemaName,
          system: opts.system,
          prompt,
          temperature: opts.temperature,
          signal,
        }),
        signal,
      );
      usage.inputTokens = add(usage.inputTokens, res.usage?.inputTokens);
      usage.outputTokens = add(usage.outputTokens, res.usage?.outputTokens);
      return { ok: true, raw: res.raw };
    } catch (err) {
      if (signal.aborted) return { ok: false, error: `Timed out after ${timeoutMs} ms` };
      const transient = isTransient(err);
      if (!transient || attempt >= MAX_TRANSIENT_RETRIES) {
        return { ok: false, error: describe(err) };
      }
      // Exponential backoff with full jitter, cut short if the budget runs out.
      await Promise.race([
        sleep(Math.random() * BACKOFF_BASE_MS * 2 ** attempt),
        new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
      ]);
      if (signal.aborted) return { ok: false, error: `Timed out after ${timeoutMs} ms` };
    }
  }
}

function validate<T>(
  opts: StructuredCallOptions<T>,
  raw: unknown,
): { ok: true; value: T } | { ok: false; problems: string[] } {
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const problems = opts.semanticCheck?.(parsed.data) ?? [];
  return problems.length ? { ok: false, problems } : { ok: true, value: parsed.data };
}

/** Same task again, plus what was wrong with the previous answer. */
export function repairPrompt(prompt: string, previous: unknown, problems: string[]): string {
  const shown = typeof previous === 'string' ? previous : JSON.stringify(previous);
  return [
    prompt,
    '',
    '<previous_output>',
    truncate(shown ?? 'null'),
    '</previous_output>',
    'Your previous output failed validation:',
    ...problems.map((p) => `- ${p}`),
    'Return only JSON matching the schema.',
  ].join('\n');
}

export function isTransient(err: unknown): boolean {
  if (err instanceof LlmProviderError) return err.transient;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
    return true;
  return false;
}

/** Providers may ignore the abort signal; the budget is enforced here either way. */
function raceAbort<R>(promise: Promise<R>, signal: AbortSignal): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function describe(err: unknown): string {
  if (err instanceof LlmProviderError) {
    return `${err.statusCode ? `HTTP ${err.statusCode}: ` : ''}${err.message}`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function add(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

function truncate(s: string): string {
  return s.length > MAX_ERROR_LENGTH ? `${s.slice(0, MAX_ERROR_LENGTH)}…` : s;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
