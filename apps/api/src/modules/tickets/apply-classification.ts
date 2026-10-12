import type { AiClassification, Prisma, Ticket, TicketEventType } from '@prisma/client';

export interface PlannedEvent {
  type: TicketEventType;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Prisma.InputJsonObject;
}

export interface ClassificationPlan {
  data: Prisma.TicketUncheckedUpdateManyInput;
  events: PlannedEvent[];
}

/**
 * Decides what a classification run changes on its ticket (pure, unit tested):
 * - FAILED (provider unreachable): nothing, not even an event. The ticket keeps its priority.
 * - FALLBACK: an AI_CLASSIFIED event for the timeline, but no field changes (rules, not a model).
 * - VALID / REPAIRED: priority (source AI) unless an agent set it manually; intent unless an agent
 *   corrected it manually. Each change gets its own event, plus AI_CLASSIFIED.
 * CLOSED tickets are read-only, so only the event is recorded for them.
 */
export function planClassification(
  ticket: Pick<Ticket, 'priority' | 'prioritySource' | 'intent' | 'status'>,
  c: Pick<AiClassification, 'id' | 'outcome' | 'intent' | 'priority' | 'confidence'>,
  intentSetManually: boolean,
): ClassificationPlan | null {
  if (c.outcome === 'FAILED') return null;

  const data: Prisma.TicketUncheckedUpdateManyInput = {};
  const events: PlannedEvent[] = [];
  const trusted = (c.outcome === 'VALID' || c.outcome === 'REPAIRED') && ticket.status !== 'CLOSED';
  const kept: string[] = [];

  if (trusted) {
    if (ticket.prioritySource === 'MANUAL') {
      if (c.priority !== ticket.priority) kept.push('priority (set manually)');
    } else if (c.priority !== ticket.priority || ticket.prioritySource !== 'AI') {
      data.priority = c.priority;
      data.prioritySource = 'AI';
      events.push({
        type: 'PRIORITY_CHANGED',
        fromValue: ticket.priority,
        toValue: c.priority,
        metadata: { fromSource: ticket.prioritySource, toSource: 'AI', classificationId: c.id },
      });
    }

    if (intentSetManually) {
      if (c.intent !== ticket.intent) kept.push('intent (set manually)');
    } else if (c.intent !== ticket.intent) {
      data.intent = c.intent;
      events.push({
        type: 'INTENT_CHANGED',
        fromValue: ticket.intent,
        toValue: c.intent,
        metadata: { classificationId: c.id },
      });
    }
  }

  events.unshift({
    type: 'AI_CLASSIFIED',
    toValue: c.intent,
    metadata: {
      classificationId: c.id,
      outcome: c.outcome,
      intent: c.intent,
      priority: c.priority,
      confidence: c.confidence,
      applied: trusted,
      ...(kept.length ? { kept } : {}),
    },
  });
  return { data, events };
}
