import { z } from 'zod';
import { TicketChannelSchema, type TicketStatus } from './enums';

/** Allowed ticket status transitions. CLOSED is terminal. */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

export const TICKET_LIMITS = { subject: 200, body: 10_000, note: 1_000 } as const;

/** Client-side form schema for creating a ticket; the API enforces the same limits with class-validator. */
export const CreateTicketFormSchema = z.object({
  customerId: z.string().uuid(),
  subject: z.string().trim().min(3).max(TICKET_LIMITS.subject),
  body: z.string().trim().min(10).max(TICKET_LIMITS.body),
  channel: TicketChannelSchema,
});
export type CreateTicketForm = z.infer<typeof CreateTicketFormSchema>;
