import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, VersionConflictError } from '../../common/errors/app-errors';
import { SYSTEM_ACTOR, type Actor } from '../../common/http/actor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertTransition, canTransition } from '../tickets/ticket-state-machine';
import type {
  DecideEscalationDto,
  EscalationDecisionResultDto,
  EscalationDto,
} from './dto/escalation.dto';
import {
  evaluateEscalation,
  REPEAT_CONTACT_WINDOW_DAYS,
  sameFindings,
  type EscalationReason,
} from './escalation-rules';

/** What prompted an evaluation; stored on the audit event. */
export type EvaluationTrigger = 'CLASSIFICATION' | 'DRAFT' | 'MANUAL';

const recommendationInclude = {
  decidedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.EscalationRecommendationInclude;

type RecommendationRow = Prisma.EscalationRecommendationGetPayload<{
  include: typeof recommendationInclude;
}>;

const latestFirst = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.EscalationRecommendationOrderByWithRelationInput[];

/**
 * Runs the escalation rules engine on a ticket's current data and stores the result as an
 * EscalationRecommendation. A new row is written only when the findings (level + rule set) differ from
 * the ticket's latest one (the first evaluation is always stored, even when nothing fires), so re-evaluating after every AI step does not pile up identical rows, and a
 * dismissed recommendation is not raised again until something new fires. Recommending never changes the
 * ticket; an agent's decision does.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Explicit evaluation (POST /tickets/:id/escalation/evaluate). Only tickets that can still move to
   * ESCALATED are evaluated; others get 409.
   */
  async evaluate(ticketId: string, requestedBy: Actor): Promise<EscalationDto> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });
    if (!ticket) throw new NotFoundError('Ticket', ticketId);
    if (!canTransition(ticket.status, 'ESCALATED')) {
      throw new ConflictError(
        'ESCALATION_NOT_APPLICABLE',
        `Ticket is ${ticket.status}; escalation is only evaluated for OPEN or IN_PROGRESS tickets.`,
      );
    }
    return this.run(ticketId, 'MANUAL', requestedBy);
  }

  /**
   * Automatic evaluation after classification or drafting. Skips tickets that cannot be escalated and
   * never throws: a failure here must not fail the AI step that triggered it.
   */
  async evaluateQuietly(ticketId: string, trigger: EvaluationTrigger): Promise<void> {
    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { status: true },
      });
      if (!ticket || !canTransition(ticket.status, 'ESCALATED')) return;
      await this.run(ticketId, trigger, SYSTEM_ACTOR);
    } catch (err) {
      this.logger.error(`Escalation evaluation of ticket ${ticketId} failed`, (err as Error).stack);
    }
  }

  async list(ticketId: string): Promise<EscalationDto[]> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundError('Ticket', ticketId);
    const rows = await this.prisma.escalationRecommendation.findMany({
      where: { ticketId },
      orderBy: latestFirst,
      include: recommendationInclude,
    });
    return rows.map(toDto);
  }

  /**
   * Accept or dismiss the ticket's latest pending recommendation. Accepting moves the ticket to ESCALATED
   * with optimistic locking. The decision, the status change and their audit events are one transaction.
   */
  decide(
    escalationId: string,
    dto: DecideEscalationDto,
    actor: Actor,
  ): Promise<EscalationDecisionResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.escalationRecommendation.findUnique({ where: { id: escalationId } });
      if (!rec) throw new NotFoundError('Escalation', escalationId);
      if (!rec.recommended) {
        throw new ConflictError(
          'ESCALATION_NOT_RECOMMENDED',
          'No rule fired for this evaluation, so there is nothing to accept or dismiss.',
        );
      }
      if (rec.decision !== 'PENDING') {
        throw new ConflictError(
          'ESCALATION_ALREADY_DECIDED',
          `This recommendation was already ${rec.decision.toLowerCase()}.`,
        );
      }
      const latest = await tx.escalationRecommendation.findFirst({
        where: { ticketId: rec.ticketId },
        orderBy: latestFirst,
        select: { id: true },
      });
      if (latest?.id !== rec.id) {
        throw new ConflictError(
          'ESCALATION_SUPERSEDED',
          'A newer evaluation replaced this recommendation. Reload and decide on the latest one.',
        );
      }

      const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: rec.ticketId } });
      if (dto.version !== undefined && dto.version !== ticket.version) {
        throw new VersionConflictError('Ticket', dto.version, ticket.version);
      }
      const accept = dto.decision === 'ACCEPTED';
      if (accept) assertTransition(ticket.status, 'ESCALATED');

      // Guarded write: a concurrent decision on the same row makes this a no-op → 409.
      const now = new Date();
      const { count } = await tx.escalationRecommendation.updateMany({
        where: { id: rec.id, decision: 'PENDING' },
        data: { decision: dto.decision, decidedById: actor.id, decidedAt: now },
      });
      if (count === 0) {
        throw new ConflictError(
          'ESCALATION_ALREADY_DECIDED',
          'This recommendation was just decided.',
        );
      }

      let { status, version } = ticket;
      if (accept) {
        const res = await tx.ticket.updateMany({
          where: { id: ticket.id, version: ticket.version },
          data: { status: 'ESCALATED', version: { increment: 1 } },
        });
        if (res.count === 0) throw new VersionConflictError('Ticket', ticket.version);
        status = 'ESCALATED';
        version = ticket.version + 1;
      }

      const metadata = {
        escalationId: rec.id,
        level: rec.level,
        triggeredRules: rec.triggeredRules,
        ...(dto.note ? { note: dto.note } : {}),
      };
      const at = now.getTime();
      await tx.ticketEvent.createMany({
        data: [
          {
            type: accept ? ('ESCALATION_ACCEPTED' as const) : ('ESCALATION_DISMISSED' as const),
            fromValue: 'PENDING',
            toValue: dto.decision,
            metadata,
          },
          ...(accept
            ? [
                {
                  type: 'STATUS_CHANGED' as const,
                  fromValue: ticket.status,
                  toValue: 'ESCALATED',
                  metadata,
                },
              ]
            : []),
        ].map((e, i) => ({
          ...e,
          ticketId: ticket.id,
          actorType: actor.type,
          actorId: actor.id,
          createdAt: new Date(at + i),
        })),
      });

      const updated = await tx.escalationRecommendation.findUniqueOrThrow({
        where: { id: rec.id },
        include: recommendationInclude,
      });
      return { escalation: toDto(updated), ticket: { id: ticket.id, status, version } };
    });
  }

  /** Gathers the engine's inputs, evaluates, and stores a new recommendation if the findings changed. */
  private async run(
    ticketId: string,
    trigger: EvaluationTrigger,
    requestedBy: Actor,
  ): Promise<EscalationDto> {
    const now = new Date();
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { customer: { select: { tier: true } } },
    });
    const [classification, draft, recentCustomerTickets, agentReplies, previous] =
      await Promise.all([
        this.prisma.aiClassification.findFirst({
          where: { ticketId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, outcome: true, confidence: true, sentiment: true, signals: true },
        }),
        this.prisma.aiDraftResponse.findFirst({
          where: { ticketId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, answerable: true, outcome: true },
        }),
        this.prisma.ticket.count({
          where: {
            customerId: ticket.customerId,
            id: { not: ticketId },
            createdAt: { gte: new Date(now.getTime() - REPEAT_CONTACT_WINDOW_DAYS * 86_400_000) },
          },
        }),
        this.prisma.ticketMessage.count({ where: { ticketId, authorType: 'AGENT' } }),
        this.prisma.escalationRecommendation.findFirst({
          where: { ticketId },
          orderBy: latestFirst,
          include: recommendationInclude,
        }),
      ]);

    const result = evaluateEscalation({
      ticket: {
        subject: ticket.subject,
        body: ticket.body,
        status: ticket.status,
        priority: ticket.priority,
        intent: ticket.intent,
        slaDueAt: ticket.slaDueAt,
        customerTier: ticket.customer.tier,
      },
      classification,
      draft,
      recentCustomerTickets,
      hasAgentReply: agentReplies > 0,
      now,
    });

    const unchanged = previous !== null && sameFindings(previous, result);
    this.logger.log(
      JSON.stringify({
        event: 'escalation_evaluated',
        ticketId,
        trigger,
        level: result.level,
        triggeredRules: result.triggeredRules,
        stored: !unchanged,
      }),
    );
    if (unchanged) return toDto(previous);

    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.escalationRecommendation.create({
        data: {
          ticketId,
          recommended: result.recommended,
          level: result.level,
          triggeredRules: result.triggeredRules,
          reasons: result.reasons as unknown as Prisma.InputJsonArray,
        },
        include: recommendationInclude,
      });
      // Only a positive recommendation goes on the timeline. The ticket row is unchanged (no version bump).
      if (result.recommended) {
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorType: SYSTEM_ACTOR.type,
            actorId: SYSTEM_ACTOR.id,
            type: 'ESCALATION_RECOMMENDED',
            toValue: result.level,
            metadata: {
              escalationId: rec.id,
              triggeredRules: result.triggeredRules,
              trigger,
              classificationId: classification?.id ?? null,
              draftId: draft?.id ?? null,
              requestedBy: requestedBy.id,
            },
          },
        });
      }
      return toDto(rec);
    });
  }
}

function toDto(row: RecommendationRow): EscalationDto {
  return {
    id: row.id,
    ticketId: row.ticketId,
    recommended: row.recommended,
    level: row.level,
    triggeredRules: row.triggeredRules,
    reasons: row.reasons as unknown as EscalationReason[],
    decision: row.decision,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}
