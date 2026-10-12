import { $Enums } from '@prisma/client';
import * as shared from '@copilot/shared';

/** Prisma enums (DB) and shared Zod enums (AI schemas, web) must never drift apart. */
const pairs: Array<[string, Record<string, string>, readonly string[]]> = [
  ['UserRole', $Enums.UserRole, shared.USER_ROLES],
  ['CustomerTier', $Enums.CustomerTier, shared.CUSTOMER_TIERS],
  ['TicketChannel', $Enums.TicketChannel, shared.TICKET_CHANNELS],
  ['TicketStatus', $Enums.TicketStatus, shared.TICKET_STATUSES],
  ['TicketPriority', $Enums.TicketPriority, shared.TICKET_PRIORITIES],
  ['PrioritySource', $Enums.PrioritySource, shared.PRIORITY_SOURCES],
  ['TicketIntent', $Enums.TicketIntent, shared.TICKET_INTENTS],
  ['MessageAuthorType', $Enums.MessageAuthorType, shared.MESSAGE_AUTHOR_TYPES],
  ['ActorType', $Enums.ActorType, shared.ACTOR_TYPES],
  ['TicketEventType', $Enums.TicketEventType, shared.TICKET_EVENT_TYPES],
  ['KbDocumentStatus', $Enums.KbDocumentStatus, shared.KB_DOCUMENT_STATUSES],
  ['AiOutcome', $Enums.AiOutcome, shared.AI_OUTCOMES],
  ['DraftStatus', $Enums.DraftStatus, shared.DRAFT_STATUSES],
  ['EscalationLevel', $Enums.EscalationLevel, shared.ESCALATION_LEVELS],
  ['EscalationDecision', $Enums.EscalationDecision, shared.ESCALATION_DECISIONS],
  ['Sentiment', $Enums.Sentiment, shared.SENTIMENTS],
];

describe('Prisma enums match @copilot/shared', () => {
  it.each(pairs)('%s', (_name, prismaEnum, sharedValues) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...sharedValues].sort());
  });
});
