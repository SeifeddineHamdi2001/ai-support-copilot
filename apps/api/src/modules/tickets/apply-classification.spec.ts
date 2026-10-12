import type { AiClassification, Ticket } from '@prisma/client';
import { planClassification } from './apply-classification';

type T = Pick<Ticket, 'priority' | 'prioritySource' | 'intent' | 'status'>;
type C = Pick<AiClassification, 'id' | 'outcome' | 'intent' | 'priority' | 'confidence'>;

const fresh: T = { priority: 'MEDIUM', prioritySource: 'DEFAULT', intent: null, status: 'OPEN' };
const result: C = {
  id: 'c1',
  outcome: 'VALID',
  intent: 'REFUND_REQUEST',
  priority: 'HIGH',
  confidence: 0.9,
};

const types = (plan: ReturnType<typeof planClassification>) => plan?.events.map((e) => e.type);

describe('planClassification', () => {
  it('applies priority (source AI) and intent from a VALID result, with one event per change', () => {
    const plan = planClassification(fresh, result, false);

    expect(plan?.data).toEqual({
      priority: 'HIGH',
      prioritySource: 'AI',
      intent: 'REFUND_REQUEST',
    });
    expect(types(plan)).toEqual(['AI_CLASSIFIED', 'PRIORITY_CHANGED', 'INTENT_CHANGED']);
    expect(plan?.events[1]).toMatchObject({
      fromValue: 'MEDIUM',
      toValue: 'HIGH',
      metadata: { fromSource: 'DEFAULT', toSource: 'AI', classificationId: 'c1' },
    });
    expect(plan?.events[0].metadata).toMatchObject({ outcome: 'VALID', applied: true });
  });

  it('applies a REPAIRED result the same way', () => {
    expect(
      planClassification(fresh, { ...result, outcome: 'REPAIRED' }, false)?.data,
    ).toHaveProperty('priority', 'HIGH');
  });

  it('never overwrites a MANUAL priority', () => {
    const plan = planClassification(
      { ...fresh, priority: 'LOW', prioritySource: 'MANUAL' },
      result,
      false,
    );

    expect(plan?.data).toEqual({ intent: 'REFUND_REQUEST' });
    expect(types(plan)).toEqual(['AI_CLASSIFIED', 'INTENT_CHANGED']);
    expect(plan?.events[0].metadata).toMatchObject({ kept: ['priority (set manually)'] });
  });

  it('keeps an intent an agent corrected manually', () => {
    const plan = planClassification({ ...fresh, intent: 'BILLING' }, result, true);
    expect(plan?.data).toEqual({ priority: 'HIGH', prioritySource: 'AI' });
  });

  it('switches DEFAULT to AI source even when the priority value is unchanged', () => {
    const plan = planClassification(fresh, { ...result, priority: 'MEDIUM' }, false);
    expect(plan?.data).toMatchObject({ priority: 'MEDIUM', prioritySource: 'AI' });
  });

  it('records only the event when nothing changes', () => {
    const plan = planClassification(
      { ...fresh, priority: 'HIGH', prioritySource: 'AI', intent: 'REFUND_REQUEST' },
      result,
      false,
    );
    expect(plan?.data).toEqual({});
    expect(types(plan)).toEqual(['AI_CLASSIFIED']);
  });

  it('does not apply a FALLBACK result, but records it on the timeline', () => {
    const plan = planClassification(fresh, { ...result, outcome: 'FALLBACK' }, false);
    expect(plan?.data).toEqual({});
    expect(plan?.events[0].metadata).toMatchObject({ outcome: 'FALLBACK', applied: false });
  });

  it('changes nothing at all when the provider FAILED', () => {
    expect(planClassification(fresh, { ...result, outcome: 'FAILED' }, false)).toBeNull();
  });

  it('does not touch fields of a CLOSED ticket', () => {
    expect(planClassification({ ...fresh, status: 'CLOSED' }, result, false)?.data).toEqual({});
  });
});
