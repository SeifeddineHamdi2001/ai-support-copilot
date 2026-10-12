import type { TicketSortField } from '@copilot/shared';
import type { Prisma } from '@prisma/client';
import { parseSort } from '../../common/http/validators';
import { UNASSIGNED, type ListTicketsQueryDto } from './dto/ticket-requests.dto';

const TICKET_NUMBER = /^#?(\d{1,9})$/;

/** Translates list filters into a Prisma `where`. Pure, so the filter semantics are unit tested. */
export function buildTicketWhere(q: ListTicketsQueryDto): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};
  if (q.status?.length) where.status = { in: q.status };
  if (q.priority?.length) where.priority = { in: q.priority };
  if (q.intent?.length) where.intent = { in: q.intent };
  if (q.customerId) where.customerId = q.customerId;
  if (q.assigneeId) where.assigneeId = q.assigneeId === UNASSIGNED ? null : q.assigneeId;

  if (q.q) {
    const number = TICKET_NUMBER.exec(q.q);
    where.OR = [
      { subject: { contains: q.q, mode: 'insensitive' } },
      { body: { contains: q.q, mode: 'insensitive' } },
      ...(number ? [{ number: Number(number[1]) }] : []),
    ];
  }
  return where;
}

/**
 * `-priority` lists URGENT first: Postgres orders enums by declaration order (LOW < … < URGENT).
 * A unique tie-breaker keeps pagination stable when the sort key has duplicates.
 */
export function buildTicketOrderBy(sort: string): Prisma.TicketOrderByWithRelationInput[] {
  const { field, direction } = parseSort<TicketSortField>(sort);
  const primary: Prisma.TicketOrderByWithRelationInput =
    field === 'slaDueAt'
      ? { slaDueAt: { sort: direction, nulls: 'last' } }
      : { [field]: direction };
  return field === 'number' ? [primary] : [primary, { number: 'desc' }];
}
