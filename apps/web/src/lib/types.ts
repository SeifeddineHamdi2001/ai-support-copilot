import type {
  ActorType,
  AiOutcome,
  CustomerTier,
  MessageAuthorType,
  PrioritySource,
  Sentiment,
  TicketChannel,
  TicketEventType,
  TicketIntent,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@copilot/shared';

/** Response shapes of the REST API (mirrors the Nest response DTOs; dates arrive as ISO strings). */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export interface Agent {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
  company: string | null;
  tier: CustomerTier;
}

export interface Customer extends CustomerSummary {
  ticketCount: number;
}

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  body: string;
  channel: TicketChannel;
  status: TicketStatus;
  priority: TicketPriority;
  prioritySource: PrioritySource;
  intent: TicketIntent | null;
  customerId: string;
  assigneeId: string | null;
  version: number;
  slaDueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: CustomerSummary;
  assignee: UserSummary | null;
}

export interface TicketMessage {
  id: string;
  authorType: MessageAuthorType;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  allowedTransitions: TicketStatus[];
}

export interface TicketEvent {
  id: string;
  type: TicketEventType;
  actorType: ActorType;
  actorId: string | null;
  actor: UserSummary | null;
  fromValue: string | null;
  toValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AiClassification {
  id: string;
  ticketId: string;
  intent: TicketIntent;
  priority: TicketPriority;
  confidence: number;
  reasoning: string;
  sentiment: Sentiment;
  signals: string[];
  language: string | null;
  outcome: AiOutcome;
  provider: string;
  model: string;
  promptVersion: string;
  errorMessage: string | null;
  latencyMs: number;
  createdAt: string;
}

export interface ClassifyResult {
  classification: AiClassification;
  ticket: TicketDetail;
}
