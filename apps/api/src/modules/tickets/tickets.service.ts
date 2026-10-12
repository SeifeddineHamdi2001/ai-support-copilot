import { SLA_HOURS_BY_TIER } from '@copilot/shared';
import { Injectable } from '@nestjs/common';
import { Prisma, type Ticket, type TicketEventType } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
  ValidationFailedError,
  VersionConflictError,
} from '../../common/errors/app-errors';
import type { Actor } from '../../common/http/actor';
import { paginate, Paginated, skipTake } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  UpdateTicketDto,
} from './dto/ticket-requests.dto';
import type { TicketDetailDto, TicketDto, TicketEventDto } from './dto/ticket-responses.dto';
import { buildTicketOrderBy, buildTicketWhere } from './ticket-query';
import {
  allowedTransitions,
  assertTransition,
  transitionSideEffects,
} from './ticket-state-machine';

type Db = PrismaService | Prisma.TransactionClient;

const userSummary = { select: { id: true, name: true, email: true } } as const;

const ticketInclude = {
  customer: { select: { id: true, name: true, email: true, company: true, tier: true } },
  assignee: userSummary,
} satisfies Prisma.TicketInclude;

const ticketDetailInclude = {
  ...ticketInclude,
  messages: { orderBy: { createdAt: 'asc' } },
  assignments: {
    orderBy: { assignedAt: 'desc' },
    include: { assignee: userSummary, assignedBy: userSummary },
  },
} satisfies Prisma.TicketInclude;

interface EventInput {
  type: TicketEventType;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Prisma.InputJsonObject;
}

/** What a mutation wants to change. `null` from a planner means "nothing to do" (idempotent no-op). */
interface MutationPlan {
  data: Prisma.TicketUncheckedUpdateManyInput;
  events: EventInput[];
  /** Extra writes in the same transaction, after the guarded ticket update succeeded. */
  after?: (tx: Prisma.TransactionClient) => Promise<unknown>;
}

/** CLOSED is terminal: no field or assignment changes (status changes are refused by the state machine). */
function assertNotClosed(ticket: Ticket): void {
  if (ticket.status === 'CLOSED') {
    throw new ConflictError(
      'TICKET_CLOSED',
      'Ticket is closed and read-only. Open a new ticket instead.',
    );
  }
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListTicketsQueryDto): Promise<Paginated<TicketDto>> {
    const where = buildTicketWhere(q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: ticketInclude,
        orderBy: buildTicketOrderBy(q.sort),
        ...skipTake(q),
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  get(id: string): Promise<TicketDetailDto> {
    return this.getDetail(this.prisma, id);
  }

  /**
   * Creates the ticket, its first customer message and the CREATED event in one nested write (a single
   * transaction). The SLA due date comes from the customer's tier. AI classification runs after commit
   * (Phase 3), so an AI failure can never block or corrupt ticket creation.
   */
  async create(dto: CreateTicketDto, actor: Actor): Promise<TicketDetailDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true, tier: true },
    });
    if (!customer) {
      throw new UnprocessableError(
        'INVALID_CUSTOMER',
        `Customer ${dto.customerId} does not exist.`,
        [{ field: 'customerId', message: 'unknown customer' }],
      );
    }

    const now = new Date();
    const channel = dto.channel ?? 'WEB';
    const ticket = await this.prisma.ticket.create({
      data: {
        subject: dto.subject,
        body: dto.body,
        channel,
        customerId: customer.id,
        slaDueAt: new Date(now.getTime() + SLA_HOURS_BY_TIER[customer.tier] * 3_600_000),
        messages: {
          create: { authorType: 'CUSTOMER', authorId: customer.id, body: dto.body, createdAt: now },
        },
        events: {
          create: {
            type: 'CREATED',
            actorType: actor.type,
            actorId: actor.id,
            toValue: 'OPEN',
            metadata: { channel },
            createdAt: now,
          },
        },
      },
      select: { id: true },
    });
    return this.get(ticket.id);
  }

  /** Manual priority / intent changes. A manual priority is locked against later AI classification. */
  update(id: string, dto: UpdateTicketDto, actor: Actor): Promise<TicketDetailDto> {
    if (dto.priority === undefined && dto.intent === undefined) {
      throw new ValidationFailedError(
        [{ field: 'priority', message: 'provide priority and/or intent' }],
        'Nothing to update: provide priority and/or intent.',
      );
    }

    return this.mutate(id, dto.version, actor, (t) => {
      assertNotClosed(t);
      const data: Prisma.TicketUncheckedUpdateManyInput = {};
      const events: EventInput[] = [];

      if (
        dto.priority !== undefined &&
        (dto.priority !== t.priority || t.prioritySource !== 'MANUAL')
      ) {
        data.priority = dto.priority;
        data.prioritySource = 'MANUAL';
        events.push({
          type: 'PRIORITY_CHANGED',
          fromValue: t.priority,
          toValue: dto.priority,
          metadata: { fromSource: t.prioritySource, toSource: 'MANUAL' },
        });
      }
      if (dto.intent !== undefined && dto.intent !== t.intent) {
        data.intent = dto.intent;
        events.push({ type: 'INTENT_CHANGED', fromValue: t.intent, toValue: dto.intent });
      }
      return events.length ? { data, events } : null;
    });
  }

  changeStatus(id: string, dto: ChangeStatusDto, actor: Actor): Promise<TicketDetailDto> {
    return this.mutate(id, dto.version, actor, (t) => {
      assertTransition(t.status, dto.status);
      return {
        data: { status: dto.status, ...transitionSideEffects(dto.status, new Date()) },
        events: [
          {
            type: 'STATUS_CHANGED',
            fromValue: t.status,
            toValue: dto.status,
            metadata: dto.note ? { note: dto.note } : {},
          },
        ],
      };
    });
  }

  /**
   * Assign, reassign or unassign (`assigneeId: null`). The current TicketAssignment row is closed
   * (`unassignedAt`) and a new one opened, so the full history is kept. Assigning does not change status.
   */
  assign(id: string, dto: AssignTicketDto, actor: Actor): Promise<TicketDetailDto> {
    return this.mutate(id, dto.version, actor, async (t, tx) => {
      assertNotClosed(t);
      if (dto.assigneeId === t.assigneeId) return null;

      if (dto.assigneeId) {
        const agent = await tx.user.findUnique({
          where: { id: dto.assigneeId },
          select: { isActive: true },
        });
        if (!agent?.isActive) {
          throw new UnprocessableError(
            'INVALID_ASSIGNEE',
            `${dto.assigneeId} is not an active agent.`,
            [{ field: 'assigneeId', message: 'unknown or inactive agent' }],
          );
        }
      }

      const newAssignee = dto.assigneeId;
      return {
        data: { assigneeId: newAssignee },
        events: [
          newAssignee
            ? { type: 'ASSIGNED', fromValue: t.assigneeId, toValue: newAssignee }
            : { type: 'UNASSIGNED', fromValue: t.assigneeId },
        ],
        after: async (tx) => {
          const now = new Date();
          await tx.ticketAssignment.updateMany({
            where: { ticketId: id, unassignedAt: null },
            data: { unassignedAt: now },
          });
          if (newAssignee) {
            await tx.ticketAssignment.create({
              data: {
                ticketId: id,
                assigneeId: newAssignee,
                assignedById: actor.id,
                assignedAt: now,
              },
            });
          }
        },
      };
    });
  }

  /** Audit timeline, oldest first, with USER actors resolved to names. */
  async events(id: string): Promise<TicketEventDto[]> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, select: { id: true } });
    if (!ticket) throw new NotFoundError('Ticket', id);

    const events = await this.prisma.ticketEvent.findMany({
      where: { ticketId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const actorIds = [...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : [])))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      ...userSummary,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return events.map((e) => ({
      ...e,
      actor: e.actorType === 'USER' && e.actorId ? (byId.get(e.actorId) ?? null) : null,
    }));
  }

  /**
   * The one write path for ticket mutations (optimistic locking + audit in one transaction):
   * 1. read the ticket; 404 if missing, 409 if the client's version is stale;
   * 2. let the planner validate and describe the change (or return null for a no-op);
   * 3. `updateMany WHERE id AND version` bumps the version; 0 rows means a concurrent writer won → 409;
   * 4. write TicketEvents (+ assignment rows) in the same transaction, so state and audit never diverge.
   */
  private async mutate(
    id: string,
    version: number,
    actor: Actor,
    plan: (
      ticket: Ticket,
      tx: Prisma.TransactionClient,
    ) => MutationPlan | null | Promise<MutationPlan | null>,
  ): Promise<TicketDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current) throw new NotFoundError('Ticket', id);
      if (current.version !== version) {
        throw new VersionConflictError('Ticket', version, current.version);
      }

      const change = await plan(current, tx);
      if (!change) return this.getDetail(tx, id);

      const { count } = await tx.ticket.updateMany({
        where: { id, version },
        data: { ...change.data, version: { increment: 1 } },
      });
      if (count === 0) throw new VersionConflictError('Ticket', version);

      await change.after?.(tx);
      await tx.ticketEvent.createMany({
        data: change.events.map((e) => ({
          ticketId: id,
          actorType: actor.type,
          actorId: actor.id,
          type: e.type,
          fromValue: e.fromValue ?? null,
          toValue: e.toValue ?? null,
          metadata: e.metadata ?? {},
        })),
      });
      return this.getDetail(tx, id);
    });
  }

  private async getDetail(db: Db, id: string): Promise<TicketDetailDto> {
    const ticket = await db.ticket.findUnique({ where: { id }, include: ticketDetailInclude });
    if (!ticket) throw new NotFoundError('Ticket', id);
    return { ...ticket, allowedTransitions: [...allowedTransitions(ticket.status)] };
  }
}
