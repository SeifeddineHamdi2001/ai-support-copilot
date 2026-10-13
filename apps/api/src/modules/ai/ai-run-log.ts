import type { Logger } from '@nestjs/common';
import type { AiOutcome } from '@prisma/client';

export interface AiRunLog {
  /** Prompt version, e.g. `classify@v1`. */
  task: string;
  ticketId: string;
  provider: string;
  model: string;
  outcome: AiOutcome;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  /** Task-specific numbers (e.g. citations kept). Never ticket text: logs must not carry customer data. */
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * One JSON line per AI run (`event: "ai_run"`), so runs can be filtered and aggregated by task, outcome,
 * provider or latency. Usable outcomes log at info level, FALLBACK/FAILED at warn. Only ids and metrics
 * are logged; prompts, outputs and ticket text stay in the database rows.
 */
export function logAiRun(logger: Logger, run: AiRunLog): void {
  const { extra, ...fields } = run;
  const line = JSON.stringify({ event: 'ai_run', ...fields, ...extra });
  if (run.outcome === 'VALID' || run.outcome === 'REPAIRED') logger.log(line);
  else logger.warn(line);
}
