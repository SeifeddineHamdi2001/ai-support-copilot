import { TICKET_STATUSES } from '@copilot/shared';
import type { TicketStatus } from '@prisma/client';
import { InvalidTransitionError } from '../../common/errors/app-errors';
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  transitionSideEffects,
} from './ticket-state-machine';

/** The spec from CLAUDE.md, written out independently of the implementation's table. */
const EXPECTED: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

const ALL = TICKET_STATUSES as readonly TicketStatus[];
const allowedPairs = ALL.flatMap((from) => EXPECTED[from].map((to) => [from, to] as const));
const forbiddenPairs = ALL.flatMap((from) =>
  ALL.filter((to) => !EXPECTED[from].includes(to)).map((to) => [from, to] as const),
);

describe('ticket state machine', () => {
  it('covers every status', () => {
    expect(ALL.map((s) => [s, [...allowedTransitions(s)].sort()])).toEqual(
      ALL.map((s) => [s, [...EXPECTED[s]].sort()]),
    );
  });

  it.each(allowedPairs)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Every forbidden pair (including X → X), not just a sample: the matrix is only 36 cells.
  it.each(forbiddenPairs)('forbids %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('reports the allowed targets in the error', () => {
    try {
      assertTransition('WAITING_ON_CUSTOMER', 'CLOSED');
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.allowed).toEqual(['IN_PROGRESS', 'RESOLVED']);
      expect(err.errorCode).toBe('INVALID_STATUS_TRANSITION');
      expect(err.detail).toContain('Allowed: IN_PROGRESS, RESOLVED');
    }
  });

  it('treats CLOSED as terminal', () => {
    expect(allowedTransitions('CLOSED')).toEqual([]);
    expect(() => assertTransition('CLOSED', 'OPEN')).toThrow(/terminal/);
  });

  describe('side effects', () => {
    const now = new Date('2026-10-12T12:00:00Z');

    it('stamps resolvedAt when resolving', () => {
      expect(transitionSideEffects('RESOLVED', now)).toEqual({ resolvedAt: now });
    });

    it('clears resolvedAt when reopening', () => {
      expect(transitionSideEffects('OPEN', now)).toEqual({ resolvedAt: null });
    });

    it.each(['CLOSED', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED'] as const)(
      'leaves resolvedAt alone for %s',
      (to) => {
        expect(transitionSideEffects(to, now)).toEqual({});
      },
    );
  });
});
