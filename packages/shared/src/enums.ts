import { z } from 'zod';

/**
 * Single source of truth for enum values shared by the API and the web app.
 * Prisma enums must match these exactly (enforced by apps/api/src/common/enums-sync.spec.ts).
 */
export const USER_ROLES = ['AGENT', 'MANAGER', 'ADMIN'] as const;
export const CUSTOMER_TIERS = ['STANDARD', 'PREMIUM', 'VIP'] as const;
export const TICKET_CHANNELS = ['EMAIL', 'WEB', 'CHAT', 'PHONE'] as const;
export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const PRIORITY_SOURCES = ['AI', 'MANUAL', 'DEFAULT'] as const;
export const TICKET_INTENTS = [
  'BILLING',
  'REFUND_REQUEST',
  'TECHNICAL_ISSUE',
  'BUG_REPORT',
  'ACCOUNT_ACCESS',
  'FEATURE_REQUEST',
  'CANCELLATION',
  'GENERAL_INQUIRY',
  'OTHER',
] as const;
export const MESSAGE_AUTHOR_TYPES = ['CUSTOMER', 'AGENT'] as const;
export const ACTOR_TYPES = ['USER', 'SYSTEM', 'AI'] as const;
export const TICKET_EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGED',
  'ASSIGNED',
  'UNASSIGNED',
  'PRIORITY_CHANGED',
  'INTENT_CHANGED',
  'AI_CLASSIFIED',
  'DRAFT_GENERATED',
  'DRAFT_APPROVED',
  'DRAFT_REJECTED',
  'AGENT_REPLIED',
  'ESCALATION_RECOMMENDED',
  'ESCALATION_ACCEPTED',
  'ESCALATION_DISMISSED',
] as const;
export const KB_DOCUMENT_STATUSES = ['PENDING', 'INDEXED', 'FAILED'] as const;
export const AI_OUTCOMES = ['VALID', 'REPAIRED', 'FALLBACK', 'FAILED'] as const;
export const DRAFT_STATUSES = ['DRAFT', 'APPROVED', 'REJECTED'] as const;
export const ESCALATION_LEVELS = ['NONE', 'TIER2', 'SPECIALIST', 'MANAGER'] as const;
export const ESCALATION_DECISIONS = ['PENDING', 'ACCEPTED', 'DISMISSED'] as const;
export const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'ANGRY'] as const;
export const ESCALATION_SIGNALS = [
  'LEGAL_THREAT',
  'SECURITY_OR_DATA_BREACH',
  'CHARGEBACK',
  'REPEATED_CONTACT',
  'SAFETY',
] as const;
export const ESCALATION_RULES = [
  'URGENT_PRIORITY',
  'SENSITIVE_INTENT',
  'LEGAL_SECURITY',
  'VIP_CUSTOMER',
  'LOW_CONFIDENCE',
  'KB_GAP',
  'ANGRY_REPEAT',
  'SLA_RISK',
] as const;

export const UserRoleSchema = z.enum(USER_ROLES);
export const CustomerTierSchema = z.enum(CUSTOMER_TIERS);
export const TicketChannelSchema = z.enum(TICKET_CHANNELS);
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export const TicketPrioritySchema = z.enum(TICKET_PRIORITIES);
export const PrioritySourceSchema = z.enum(PRIORITY_SOURCES);
export const TicketIntentSchema = z.enum(TICKET_INTENTS);
export const MessageAuthorTypeSchema = z.enum(MESSAGE_AUTHOR_TYPES);
export const ActorTypeSchema = z.enum(ACTOR_TYPES);
export const TicketEventTypeSchema = z.enum(TICKET_EVENT_TYPES);
export const KbDocumentStatusSchema = z.enum(KB_DOCUMENT_STATUSES);
export const AiOutcomeSchema = z.enum(AI_OUTCOMES);
export const DraftStatusSchema = z.enum(DRAFT_STATUSES);
export const EscalationLevelSchema = z.enum(ESCALATION_LEVELS);
export const EscalationDecisionSchema = z.enum(ESCALATION_DECISIONS);
export const SentimentSchema = z.enum(SENTIMENTS);
export const EscalationSignalSchema = z.enum(ESCALATION_SIGNALS);
export const EscalationRuleSchema = z.enum(ESCALATION_RULES);

export type UserRole = z.infer<typeof UserRoleSchema>;
export type CustomerTier = z.infer<typeof CustomerTierSchema>;
export type TicketChannel = z.infer<typeof TicketChannelSchema>;
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;
export type PrioritySource = z.infer<typeof PrioritySourceSchema>;
export type TicketIntent = z.infer<typeof TicketIntentSchema>;
export type MessageAuthorType = z.infer<typeof MessageAuthorTypeSchema>;
export type ActorType = z.infer<typeof ActorTypeSchema>;
export type TicketEventType = z.infer<typeof TicketEventTypeSchema>;
export type KbDocumentStatus = z.infer<typeof KbDocumentStatusSchema>;
export type AiOutcome = z.infer<typeof AiOutcomeSchema>;
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;
export type EscalationDecision = z.infer<typeof EscalationDecisionSchema>;
export type Sentiment = z.infer<typeof SentimentSchema>;
export type EscalationSignal = z.infer<typeof EscalationSignalSchema>;
export type EscalationRule = z.infer<typeof EscalationRuleSchema>;
