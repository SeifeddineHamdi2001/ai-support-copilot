import { TicketClassificationSchema, type TicketClassification } from '@copilot/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiClassification } from '@prisma/client';
import { NotFoundError } from '../../../common/errors/app-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AppEnv } from '../../../config/env.validation';
import {
  buildClassifyPrompt,
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_SCHEMA_NAME,
  CLASSIFY_SYSTEM,
  CLASSIFY_TEMPERATURE,
  type ClassifyInput,
} from '../prompts/classify.prompt';
import { logAiRun } from '../ai-run-log';
import { LLM_PROVIDER, type LlmProvider } from '../providers/llm-provider';
import { structuredCall, type StructuredCallResult } from '../structured-call';
import { classifyByKeywords } from './keyword-classifier';

/** Confidence given to the deterministic fallback, low enough to send the ticket to a human. */
export const FALLBACK_CONFIDENCE = 0.3;

/** Consistency rules the schema cannot express; a violation triggers the repair call. */
export function classificationProblems(c: TicketClassification): string[] {
  const problems: string[] = [];
  if (!/^[a-z]{2}$/.test(c.language)) {
    problems.push('language: must be a lowercase ISO 639-1 code such as "en"');
  }
  if (
    c.priority === 'LOW' &&
    c.escalationSignals.some((s) => s === 'LEGAL_THREAT' || s === 'SECURITY_OR_DATA_BREACH')
  ) {
    problems.push('priority: a legal threat or security incident cannot be LOW priority');
  }
  if (c.intent === 'FEATURE_REQUEST' && c.priority === 'URGENT') {
    problems.push('priority: a feature request cannot be URGENT');
  }
  if (new Set(c.escalationSignals).size !== c.escalationSignals.length) {
    problems.push('escalationSignals: must not contain duplicates');
  }
  return problems;
}

/** Deterministic, schema-valid stand-in when the model cannot produce a usable answer. */
export function fallbackClassification(
  input: Pick<ClassifyInput, 'subject' | 'body'>,
): TicketClassification {
  const rules = classifyByKeywords(input.subject, input.body);
  return {
    ...rules,
    confidence: Math.min(rules.confidence, FALLBACK_CONFIDENCE),
    reasoning: `Fallback (model output unusable). ${rules.reasoning}`.slice(0, 400),
  };
}

export interface ClassificationRun {
  record: AiClassification;
  /** True when the provider could not be reached (outcome FAILED). */
  providerError: boolean;
}

/**
 * Runs the classify@v1 prompt through the structured-call pipeline and stores one AiClassification row
 * per run, whatever the outcome. It never modifies the ticket: applying the result is TicketsService's job.
 */
@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async run(ticketId: string): Promise<ClassificationRun> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { subject: true, body: true, channel: true, customer: { select: { tier: true } } },
    });
    if (!ticket) throw new NotFoundError('Ticket', ticketId);

    const input: ClassifyInput = {
      subject: ticket.subject,
      body: ticket.body,
      channel: ticket.channel,
      customerTier: ticket.customer.tier,
    };
    const result = await structuredCall({
      llm: this.llm,
      schema: TicketClassificationSchema,
      schemaName: CLASSIFY_SCHEMA_NAME,
      system: CLASSIFY_SYSTEM,
      prompt: buildClassifyPrompt(input),
      temperature: CLASSIFY_TEMPERATURE,
      semanticCheck: classificationProblems,
      fallback: () => fallbackClassification(input),
      timeoutMs: this.config.get('LLM_TIMEOUT_MS', { infer: true }),
    });
    this.log(ticketId, result);

    const record = await this.prisma.aiClassification.create({
      data: {
        ticketId,
        intent: result.value.intent,
        priority: result.value.priority,
        confidence: result.value.confidence,
        reasoning: result.value.reasoning,
        sentiment: result.value.sentiment,
        signals: result.value.escalationSignals,
        language: result.value.language,
        outcome: result.outcome,
        provider: this.llm.name,
        model: this.llm.model,
        promptVersion: CLASSIFY_PROMPT_VERSION,
        rawOutput: toJson(result.raw),
        errorMessage: result.error ?? null,
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
      },
    });
    return { record, providerError: result.providerError };
  }

  /** Classification history for a ticket, newest first. */
  async list(ticketId: string): Promise<AiClassification[]> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundError('Ticket', ticketId);
    return this.prisma.aiClassification.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private log(ticketId: string, r: StructuredCallResult<TicketClassification>): void {
    logAiRun(this.logger, {
      task: CLASSIFY_PROMPT_VERSION,
      ticketId,
      provider: this.llm.name,
      model: this.llm.model,
      outcome: r.outcome,
      latencyMs: r.latencyMs,
      ...r.usage,
      error: r.error,
      extra: { intent: r.value.intent, priority: r.value.priority, confidence: r.value.confidence },
    });
  }
}

function toJson(raw: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return raw === null || raw === undefined ? Prisma.DbNull : (raw as Prisma.InputJsonValue);
}
