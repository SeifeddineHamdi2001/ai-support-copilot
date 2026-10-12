import { TICKET_TRANSITIONS } from '@copilot/shared';
import type { TicketStatus } from '@prisma/client';
import { InvalidTransitionError } from '../../common/errors/app-errors';

/**
 * Ticket status machine. Pure functions (no Nest, no DB) so every rule is unit tested directly.
 * The transition table lives in @copilot/shared so the web app can offer only valid targets.
 */
export function allowedTransitions(from: TicketStatus): readonly TicketStatus[] {
  return TICKET_TRANSITIONS[from];
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

/** Throws InvalidTransitionError (409, lists the allowed targets) unless `from → to` is allowed. */
export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, allowedTransitions(from));
  }
}

/**
 * Field changes that come with a transition: entering RESOLVED stamps `resolvedAt`, reopening clears it,
 * closing keeps it (a closed ticket was resolved at that time).
 */
export function transitionSideEffects(to: TicketStatus, now: Date): { resolvedAt?: Date | null } {
  if (to === 'RESOLVED') return { resolvedAt: now };
  if (to === 'OPEN') return { resolvedAt: null };
  return {};
}
