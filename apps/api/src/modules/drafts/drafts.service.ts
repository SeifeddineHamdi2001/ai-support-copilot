import { DraftResponseSchema, type DraftResponse } from '@copilot/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiOutcome } from '@prisma/client';
import {
  AiUnavailableError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/app-errors';
import { AI_ACTOR, type Actor } from '../../common/http/actor';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppEnv } from '../../config/env.validation';
import {
  buildDraftPrompt,
  DRAFT_PROMPT_VERSION,
  DRAFT_SCHEMA_NAME,
  DRAFT_SYSTEM,
  DRAFT_TEMPERATURE,
} from '../ai/prompts/draft.prompt';
import { logAiRun } from '../ai/ai-run-log';
import { LLM_PROVIDER, type LlmProvider } from '../ai/providers/llm-provider';
import { structuredCall, type StructuredCallResult } from '../ai/structured-call';
import { EscalationService } from '../escalation/escalation.service';
import { KbSearchService } from '../kb/kb-search.service';
import {
  draftProblems,
  fallbackDraftResponse,
  groundDraft,
  holdingDraft,
  stripCitationMarkers,
  type GroundedDraft,
  type RetrievedSource,
} from './citations';
import type { DraftDto, ReviewDraftDto } from './dto/draft.dto';

/** Retrieval query: the subject plus the start of the body (where customers state the problem). */
export function retrievalQuery(ticket: { subject: string; body: string }): string {
  return `${ticket.subject}\n\n${ticket.body.slice(0, 1_000)}`;
}

/** Recorded as provider/model when no model was called because nothing passed the similarity floor. */
const RETRIEVAL_GATE = { provider: 'system', model: 'retrieval-gate' } as const;

const draftInclude = {
  reviewedBy: { select: { id: true, name: true, email: true } },
  citations: {
    orderBy: { rank: 'asc' },
    include: {
      document: { select: { id: true, title: true, slug: true } },
      chunk: { select: { id: true, headingPath: true, content: true } },
    },
  },
} satisfies Prisma.AiDraftResponseInclude;

type DraftWithRelations = Prisma.AiDraftResponseGetPayload<{ include: typeof draftInclude }>;

interface DraftRun {
  grounded: GroundedDraft;
  outcome: AiOutcome;
  provider: string;
  model: string;
  raw: unknown;
  error: string | null;
  latencyMs: number;
  usage: { inputTokens?: number; outputTokens?: number };
  sources: number;
}

/**
 * Grounded reply drafts: hybrid retrieval → (only if something passed the similarity floor) the draft@v1
 * prompt through the structured-call pipeline → citation allow-listing → one AiDraftResponse with its
 * DraftCitation rows and a DRAFT_GENERATED event, written in one transaction. Drafts are never sent: an
 * agent approves (creating the outgoing TicketMessage) or rejects them.
 */
@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: KbSearchService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly escalation: EscalationService,
  ) {}

  async generate(ticketId: string, requestedBy: Actor): Promise<DraftDto> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { subject: true, body: true, status: true },
    });
    if (!ticket) throw new NotFoundError('Ticket', ticketId);
    if (ticket.status === 'CLOSED') {
      throw new ConflictError('TICKET_CLOSED', 'Ticket is closed and read-only.');
    }

    const retrieval = await this.search.search(retrievalQuery(ticket));
    const sources: RetrievedSource[] = retrieval.results.map((hit, i) => ({
      label: `S${i + 1}`,
      rank: i + 1,
      chunkId: hit.id,
      documentId: hit.documentId,
      content: hit.content,
      similarity: hit.similarity ?? 0,
    }));

    const run =
      sources.length === 0
        ? this.ungroundedRun()
        : await this.modelRun(ticket, sources, retrieval.results);
    logAiRun(this.logger, {
      task: DRAFT_PROMPT_VERSION,
      ticketId,
      provider: run.provider,
      model: run.model,
      outcome: run.outcome,
      latencyMs: run.latencyMs,
      ...run.usage,
      error: run.error ?? undefined,
      extra: {
        answerable: run.grounded.answerable,
        holdingReason: run.grounded.holdingReason,
        sourcesRetrieved: sources.length,
        citations: run.grounded.citations.length,
      },
    });
    const draft = await this.persist(ticketId, run, requestedBy);

    if (run.grounded.holdingReason === 'PROVIDER_UNAVAILABLE') throw new AiUnavailableError();
    // A holding reply is a KB gap, which can change the escalation recommendation.
    await this.escalation.evaluateQuietly(ticketId, 'DRAFT');
    return draft;
  }

  async list(ticketId: string): Promise<DraftDto[]> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundError('Ticket', ticketId);
    const drafts = await this.prisma.aiDraftResponse.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      include: draftInclude,
    });
    return drafts.map(toDto);
  }

  /**
   * Approve (optionally with edited text) or reject a draft, once. Approving creates the agent's
   * TicketMessage. Status guard, message and audit event are one transaction, so a draft can never be
   * approved twice or approved without its message.
   */
  async review(draftId: string, dto: ReviewDraftDto, actor: Actor): Promise<DraftDto> {
    if (dto.status === 'REJECTED' && dto.content !== undefined) {
      throw new ValidationFailedError([
        { field: 'content', message: 'content can only be sent when approving' },
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.aiDraftResponse.findUnique({
        where: { id: draftId },
        select: { ticketId: true, content: true, ticket: { select: { status: true } } },
      });
      if (!draft) throw new NotFoundError('Draft', draftId);
      if (draft.ticket.status === 'CLOSED') {
        throw new ConflictError('TICKET_CLOSED', 'Ticket is closed and read-only.');
      }

      const finalContent = dto.status === 'APPROVED' ? (dto.content ?? draft.content) : undefined;
      const { count } = await tx.aiDraftResponse.updateMany({
        where: { id: draftId, status: 'DRAFT' },
        data: {
          status: dto.status,
          content: finalContent,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      });
      if (count === 0) {
        const current = await tx.aiDraftResponse.findUniqueOrThrow({
          where: { id: draftId },
          select: { status: true },
        });
        throw new ConflictError(
          'DRAFT_ALREADY_REVIEWED',
          `Draft was already ${current.status.toLowerCase()}. Generate a new draft instead.`,
        );
      }

      let messageId: string | null = null;
      if (finalContent !== undefined) {
        const message = await tx.ticketMessage.create({
          data: {
            ticketId: draft.ticketId,
            authorType: 'AGENT',
            authorId: actor.id,
            body: stripCitationMarkers(finalContent),
          },
        });
        messageId = message.id;
      }
      await tx.ticketEvent.create({
        data: {
          ticketId: draft.ticketId,
          actorType: actor.type,
          actorId: actor.id,
          type: dto.status === 'APPROVED' ? 'DRAFT_APPROVED' : 'DRAFT_REJECTED',
          toValue: dto.status,
          metadata: {
            draftId,
            messageId,
            edited: finalContent !== undefined && finalContent !== draft.content,
          },
        },
      });

      return toDto(
        await tx.aiDraftResponse.findUniqueOrThrow({
          where: { id: draftId },
          include: draftInclude,
        }),
      );
    });
  }

  /** Nothing passed the similarity floor: no model call, so the model cannot make claims. */
  private ungroundedRun(): DraftRun {
    return {
      grounded: holdingDraft('NO_SOURCES_ABOVE_FLOOR', [
        'The knowledge base has no article that matches this ticket.',
      ]),
      outcome: 'VALID',
      ...RETRIEVAL_GATE,
      raw: null,
      error: null,
      latencyMs: 0,
      usage: {},
      sources: 0,
    };
  }

  private async modelRun(
    ticket: { subject: string; body: string },
    sources: RetrievedSource[],
    hits: { title: string; headingPath: string }[],
  ): Promise<DraftRun> {
    const result: StructuredCallResult<DraftResponse> = await structuredCall({
      llm: this.llm,
      schema: DraftResponseSchema,
      schemaName: DRAFT_SCHEMA_NAME,
      system: DRAFT_SYSTEM,
      prompt: buildDraftPrompt({
        subject: ticket.subject,
        body: ticket.body,
        sources: sources.map((s, i) => ({
          label: s.label,
          chunkId: s.chunkId,
          title: hits[i].title,
          headingPath: hits[i].headingPath,
          content: s.content,
        })),
      }),
      temperature: DRAFT_TEMPERATURE,
      semanticCheck: (d) => draftProblems(d, sources),
      fallback: fallbackDraftResponse,
      timeoutMs: this.config.get('LLM_TIMEOUT_MS', { infer: true }),
    });

    const grounded =
      result.outcome === 'FAILED'
        ? holdingDraft('PROVIDER_UNAVAILABLE')
        : result.outcome === 'FALLBACK'
          ? holdingDraft('MODEL_OUTPUT_UNUSABLE')
          : groundDraft(result.value, sources);

    return {
      grounded,
      outcome: result.outcome,
      provider: this.llm.name,
      model: this.llm.model,
      raw: result.raw,
      error: result.error ?? null,
      latencyMs: result.latencyMs,
      usage: result.usage,
      sources: sources.length,
    };
  }

  private async persist(ticketId: string, run: DraftRun, requestedBy: Actor): Promise<DraftDto> {
    const { grounded } = run;
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.aiDraftResponse.create({
        data: {
          ticketId,
          content: grounded.content,
          answerable: grounded.answerable,
          confidence: grounded.confidence,
          missingInformation: grounded.missingInformation,
          provider: run.provider,
          model: run.model,
          promptVersion: DRAFT_PROMPT_VERSION,
          outcome: run.outcome,
          rawOutput: toJson(run.raw),
          errorMessage: run.error,
          latencyMs: run.latencyMs,
          citations: { create: grounded.citations },
        },
        include: draftInclude,
      });
      // The ticket row itself is unchanged, so its version is not bumped (no 409 for open editors).
      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorType: AI_ACTOR.type,
          actorId: AI_ACTOR.id,
          type: 'DRAFT_GENERATED',
          toValue: grounded.answerable ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
          metadata: {
            draftId: draft.id,
            outcome: run.outcome,
            citations: grounded.citations.length,
            sourcesRetrieved: run.sources,
            holdingReason: grounded.holdingReason,
            requestedBy: requestedBy.id,
            inputTokens: run.usage.inputTokens ?? null,
            outputTokens: run.usage.outputTokens ?? null,
          },
        },
      });
      return toDto(draft);
    });
  }
}

function toDto(draft: DraftWithRelations): DraftDto {
  return {
    id: draft.id,
    ticketId: draft.ticketId,
    content: draft.content,
    answerable: draft.answerable,
    confidence: draft.confidence,
    missingInformation: draft.missingInformation,
    status: draft.status,
    provider: draft.provider,
    model: draft.model,
    promptVersion: draft.promptVersion,
    outcome: draft.outcome,
    errorMessage: draft.errorMessage,
    latencyMs: draft.latencyMs,
    reviewedBy: draft.reviewedBy,
    reviewedAt: draft.reviewedAt,
    createdAt: draft.createdAt,
    citations: draft.citations.map((c) => ({
      id: c.id,
      label: `S${c.rank}`,
      rank: c.rank,
      score: c.score,
      quote: c.quote,
      chunkId: c.chunkId,
      documentId: c.documentId,
      document: c.document,
      chunk: c.chunk,
    })),
  };
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined
    ? Prisma.JsonNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
