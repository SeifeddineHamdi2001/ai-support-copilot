import { z } from 'zod';
import { TicketChannelSchema, type CustomerTier, type TicketStatus } from './enums';

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

/** First-response SLA by customer tier, in hours from ticket creation. */
export const SLA_HOURS_BY_TIER: Record<CustomerTier, number> = { VIP: 4, PREMIUM: 8, STANDARD: 24 };

/** Sortable ticket list fields. `sort=-createdAt` sorts descending. */
export const TICKET_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'priority',
  'status',
  'number',
  'slaDueAt',
] as const;
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

/** Client-side form schema for creating a ticket; the API enforces the same limits with class-validator. */
export const CreateTicketFormSchema = z.object({
  customerId: z.uuid({ error: 'Choose a customer' }),
  subject: z
    .string()
    .trim()
    .min(3, { error: 'Subject must be at least 3 characters' })
    .max(TICKET_LIMITS.subject, {
      error: `Subject must be at most ${TICKET_LIMITS.subject} characters`,
    }),
  body: z
    .string()
    .trim()
    .min(10, { error: 'Message must be at least 10 characters' })
    .max(TICKET_LIMITS.body, { error: `Message must be at most ${TICKET_LIMITS.body} characters` }),
  channel: TicketChannelSchema,
});
export type CreateTicketForm = z.infer<typeof CreateTicketFormSchema>;
