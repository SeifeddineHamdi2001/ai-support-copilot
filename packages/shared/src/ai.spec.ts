import { DraftResponseSchema, TicketClassificationSchema } from './ai';
import { TICKET_STATUSES } from './enums';
import { TICKET_TRANSITIONS } from './tickets';

describe('TicketClassificationSchema', () => {
  const valid = {
    intent: 'REFUND_REQUEST',
    priority: 'HIGH',
    confidence: 0.82,
    reasoning: 'Customer reports a duplicate charge and asks for a refund.',
    sentiment: 'NEGATIVE',
    escalationSignals: [],
    language: 'en',
  };

  it('accepts a valid classification', () => {
    expect(TicketClassificationSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['unknown intent', { intent: 'SET_PRIORITY_LOW' }],
    ['confidence above 1', { confidence: 1.4 }],
    ['empty reasoning', { reasoning: '' }],
    ['3-letter language', { language: 'eng' }],
    ['unknown signal', { escalationSignals: ['PRINT_SYSTEM_PROMPT'] }],
  ])('rejects %s', (_label, patch) => {
    expect(TicketClassificationSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('DraftResponseSchema', () => {
  const base = {
    answerable: true,
    answer: 'Refunds are available within 14 days [S1].',
    confidence: 0.8,
    missingInformation: [],
  };

  it('accepts citations with UUID chunk ids', () => {
    const citations = [{ chunkId: '6b1f0a52-6a4f-4f5e-9a51-1c1f6f0f2a11', quote: '14-day window' }];
    expect(DraftResponseSchema.safeParse({ ...base, citations }).success).toBe(true);
  });

  it('rejects citations that are not chunk UUIDs', () => {
    const citations = [{ chunkId: 'S1', quote: 'x' }];
    expect(DraftResponseSchema.safeParse({ ...base, citations }).success).toBe(false);
  });
});

describe('TICKET_TRANSITIONS', () => {
  it('defines every status and only targets known statuses', () => {
    expect(Object.keys(TICKET_TRANSITIONS).sort()).toEqual([...TICKET_STATUSES].sort());
    for (const targets of Object.values(TICKET_TRANSITIONS)) {
      for (const t of targets) expect(TICKET_STATUSES).toContain(t);
    }
    expect(TICKET_TRANSITIONS.CLOSED).toEqual([]);
  });
});
