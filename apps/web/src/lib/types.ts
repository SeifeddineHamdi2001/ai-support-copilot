import type {
  ActorType,
  AiOutcome,
  CustomerTier,
  DraftStatus,
  EscalationDecision,
  EscalationLevel,
  EscalationRule,
  KbDocumentStatus,
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

export interface CitedDocument {
  id: string;
  title: string;
  slug: string;
}

export interface DraftCitation {
  id: string;
  /** Marker used in the draft text, e.g. "S1". */
  label: string;
  rank: number;
  /** Cosine similarity of the chunk to the ticket. */
  score: number;
  quote: string | null;
  /** null when a re-index replaced the chunk; the quote is kept. */
  chunkId: string | null;
  documentId: string;
  document: CitedDocument;
  chunk: { id: string; headingPath: string; content: string } | null;
}

export interface Draft {
  id: string;
  ticketId: string;
  content: string;
  /** false: no grounded answer, `content` is a safe holding reply with no citations. */
  answerable: boolean;
  confidence: number;
  missingInformation: string[];
  status: DraftStatus;
  provider: string;
  model: string;
  promptVersion: string;
  outcome: AiOutcome;
  errorMessage: string | null;
  latencyMs: number;
  reviewedBy: UserSummary | null;
  reviewedAt: string | null;
  createdAt: string;
  citations: DraftCitation[];
}

export interface EscalationReason {
  rule: EscalationRule;
  level: Exclude<EscalationLevel, 'NONE'>;
  detail: string;
  /** RULE: from ticket data alone. LLM: relied on a trusted model signal. */
  source: 'RULE' | 'LLM';
}

export interface Escalation {
  id: string;
  ticketId: string;
  recommended: boolean;
  level: EscalationLevel;
  triggeredRules: EscalationRule[];
  reasons: EscalationReason[];
  decision: EscalationDecision;
  decidedBy: UserSummary | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface EscalationDecisionResult {
  escalation: Escalation;
  ticket: { id: string; status: TicketStatus; version: number };
}

export interface KbDocument {
  id: string;
  title: string;
  slug: string;
  category: string;
  sourceUri: string | null;
  contentHash: string;
  status: KbDocumentStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KbChunk {
  id: string;
  ordinal: number;
  headingPath: string;
  content: string;
  tokenCount: number;
  embeddingModel: string | null;
}

export interface KbDocumentDetail extends KbDocument {
  chunks: KbChunk[];
}

export interface IngestResult {
  status: 'created' | 'updated' | 'unchanged' | 'reembedded';
  chunks: number;
  document: KbDocument;
}

export interface KbSearchHit {
  id: string;
  documentId: string;
  title: string;
  slug: string;
  headingPath: string;
  content: string;
  /** Reciprocal Rank Fusion score (k=60). */
  rrf: number;
  similarity: number | null;
  semanticRank: number | null;
  lexicalRank: number | null;
}

export interface KbSearchResult {
  results: KbSearchHit[];
  belowFloor: KbSearchHit[];
  minSimilarity: number;
  topK: number;
  embeddingModel: string;
  staleChunks: number;
}
