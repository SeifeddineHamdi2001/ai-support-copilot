import type {
  EscalationLevel,
  EscalationRule,
  TicketChannel,
  TicketIntent,
  TicketPriority,
  TicketStatus,
} from '@copilot/shared';
import {
  CHANNEL_LABEL,
  ESCALATION_LEVEL_LABEL,
  ESCALATION_RULE_LABEL,
  INTENT_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
} from './format';
import type { TicketEvent } from './types';

const status = (v: string | null) => (v ? (STATUS_LABEL[v as TicketStatus] ?? v) : 'none');
const priority = (v: string | null) => (v ? (PRIORITY_LABEL[v as TicketPriority] ?? v) : 'none');
const intent = (v: string | null) => (v ? (INTENT_LABEL[v as TicketIntent] ?? v) : 'none');
const level = (v: unknown) => ESCALATION_LEVEL_LABEL[v as EscalationLevel] ?? String(v ?? '');
const rules = (v: unknown) =>
  Array.isArray(v) && v.length
    ? v.map((r) => ESCALATION_RULE_LABEL[r as EscalationRule] ?? String(r)).join(', ')
    : undefined;

const HOLDING_REASON: Record<string, string> = {
  NO_SOURCES_ABOVE_FLOOR: 'No knowledge base passage was similar enough.',
  MODEL_NOT_ANSWERABLE: 'The sources did not answer the question.',
  NO_VALID_CITATIONS: 'The answer cited no valid source.',
};

export interface TimelineEntry {
  actor: string;
  text: string;
  detail?: string;
}

/** Who did it, as shown in the timeline. */
export function actorName(e: TicketEvent): string {
  if (e.actorType === 'AI') return 'AI';
  if (e.actorType === 'SYSTEM') return 'System';
  return e.actor?.name ?? 'Unknown agent';
}

/** One sentence per audit event. Agent ids in from/to values are resolved with `agentName`. */
export function describeEvent(e: TicketEvent, agentName: (id: string) => string): TimelineEntry {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const actor = actorName(e);
  switch (e.type) {
    case 'CREATED':
      return {
        actor,
        text: `opened the ticket${m.channel ? ` via ${CHANNEL_LABEL[m.channel as TicketChannel] ?? m.channel}` : ''}`,
      };
    case 'STATUS_CHANGED':
      return {
        actor,
        text: `changed status from ${status(e.fromValue)} to ${status(e.toValue)}`,
        detail: typeof m.note === 'string' ? m.note : undefined,
      };
    case 'ASSIGNED':
      return {
        actor,
        text:
          e.actorId && e.actorId === e.toValue
            ? e.fromValue
              ? `took over from ${agentName(e.fromValue)}`
              : 'assigned the ticket to themselves'
            : e.fromValue
              ? `reassigned from ${agentName(e.fromValue)} to ${agentName(e.toValue ?? '')}`
              : `assigned to ${agentName(e.toValue ?? '')}`,
      };
    case 'UNASSIGNED':
      return { actor, text: e.fromValue ? `unassigned ${agentName(e.fromValue)}` : 'unassigned' };
    case 'PRIORITY_CHANGED':
      return {
        actor,
        text: `changed priority from ${priority(e.fromValue)} to ${priority(e.toValue)}`,
      };
    case 'INTENT_CHANGED':
      return {
        actor,
        text: e.fromValue
          ? `changed intent from ${intent(e.fromValue)} to ${intent(e.toValue)}`
          : `set intent to ${intent(e.toValue)}`,
      };
    case 'AI_CLASSIFIED': {
      const conf =
        typeof m.confidence === 'number' ? `, confidence ${m.confidence.toFixed(2)}` : '';
      const kept =
        Array.isArray(m.kept) && m.kept.length ? `Kept ${m.kept.join(' and ')}.` : undefined;
      if (m.applied === false) {
        return {
          actor,
          text: `suggested ${intent(String(m.intent ?? e.toValue))}${conf} (not applied)`,
          detail:
            m.outcome === 'FALLBACK'
              ? 'The model output was unusable; keyword rules were used instead.'
              : kept,
        };
      }
      return {
        actor,
        text: `classified as ${intent(String(m.intent ?? e.toValue))}, ${priority(String(m.priority ?? ''))} priority${conf}`,
        detail: kept,
      };
    }
    case 'DRAFT_GENERATED': {
      const n = typeof m.citations === 'number' ? m.citations : 0;
      if (e.toValue === 'NOT_ANSWERABLE') {
        return {
          actor,
          text: 'drafted a holding reply (no grounded answer)',
          detail: HOLDING_REASON[String(m.holdingReason)],
        };
      }
      return { actor, text: `drafted a reply citing ${n} source${n === 1 ? '' : 's'}` };
    }
    case 'DRAFT_APPROVED':
      return {
        actor,
        text: m.edited ? 'edited and approved the draft reply' : 'approved the draft reply',
      };
    case 'DRAFT_REJECTED':
      return { actor, text: 'rejected the draft reply' };
    case 'ESCALATION_RECOMMENDED':
      return {
        actor,
        text: `recommended escalation to ${level(e.toValue)}`,
        detail: rules(m.triggeredRules),
      };
    case 'ESCALATION_ACCEPTED':
      return {
        actor,
        text: `accepted escalation to ${level(m.level)}`,
        detail: typeof m.note === 'string' ? m.note : undefined,
      };
    case 'ESCALATION_DISMISSED':
      return {
        actor,
        text: `dismissed the ${level(m.level)} escalation`,
        detail: typeof m.note === 'string' ? m.note : undefined,
      };
    default:
      // Event types added to the API before the UI knows them.
      return {
        actor,
        text: String(e.type as string)
          .toLowerCase()
          .replace(/_/g, ' '),
      };
  }
}
