import { ESCALATION_RULES, type EscalationRule } from '@copilot/shared';
import {
  evaluateEscalation,
  LEVEL_RANK,
  sameFindings,
  type EscalationInput,
  type EscalationReason,
} from './escalation-rules';

const NOW = new Date('2026-10-13T12:00:00Z');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

type Overrides = {
  ticket?: Partial<EscalationInput['ticket']>;
  classification?: Partial<NonNullable<EscalationInput['classification']>> | null;
  draft?: EscalationInput['draft'];
  recentCustomerTickets?: number;
  hasAgentReply?: boolean;
};

/** A calm, well-classified STANDARD ticket with plenty of SLA left: triggers nothing. */
function input(o: Overrides = {}): EscalationInput {
  return {
    ticket: {
      subject: 'Question about invoices',
      body: 'Where can I download last month’s invoice?',
      status: 'OPEN',
      priority: 'MEDIUM',
      intent: 'BILLING',
      slaDueAt: hoursFromNow(20),
      customerTier: 'STANDARD',
      ...o.ticket,
    },
    classification:
      o.classification === null
        ? null
        : {
            outcome: 'VALID',
            confidence: 0.85,
            sentiment: 'NEUTRAL',
            signals: [],
            ...o.classification,
          },
    draft: o.draft ?? null,
    recentCustomerTickets: o.recentCustomerTickets ?? 0,
    hasAgentReply: o.hasAgentReply ?? false,
    now: NOW,
  };
}

const reasonsFor = (rule: EscalationRule, o: Overrides) =>
  evaluateEscalation(input(o)).reasons.filter((r) => r.rule === rule);

describe('evaluateEscalation', () => {
  it('recommends nothing for a calm, confidently classified ticket', () => {
    expect(evaluateEscalation(input())).toEqual({
      recommended: false,
      level: 'NONE',
      triggeredRules: [],
      reasons: [],
    });
  });

  type Case = [
    name: string,
    rule: EscalationRule,
    overrides: Overrides,
    expected: Pick<EscalationReason, 'level' | 'source'> | null,
  ];

  // One block per rule: the cases that fire it (with level and source) and the near misses that must not.
  // prettier-ignore
  const cases: Case[] = [
    // URGENT_PRIORITY
    ['URGENT priority', 'URGENT_PRIORITY', { ticket: { priority: 'URGENT' } }, { level: 'TIER2', source: 'RULE' }],
    ['HIGH priority is not urgent', 'URGENT_PRIORITY', { ticket: { priority: 'HIGH' } }, null],

    // SENSITIVE_INTENT
    ['refund request', 'SENSITIVE_INTENT', { ticket: { intent: 'REFUND_REQUEST' } }, { level: 'TIER2', source: 'RULE' }],
    ['cancellation', 'SENSITIVE_INTENT', { ticket: { intent: 'CANCELLATION' } }, { level: 'TIER2', source: 'RULE' }],
    ['billing question', 'SENSITIVE_INTENT', { ticket: { intent: 'BILLING' } }, null],
    ['not classified yet', 'SENSITIVE_INTENT', { ticket: { intent: null } }, null],

    // LEGAL_SECURITY: keyword floor (RULE) and trusted model signals (LLM)
    ['lawyer in the text', 'LEGAL_SECURITY', { ticket: { body: 'I am forwarding this to our lawyer.' } }, { level: 'MANAGER', source: 'RULE' }],
    ['breach in the text', 'LEGAL_SECURITY', { ticket: { body: 'I think our account was hacked.' } }, { level: 'SPECIALIST', source: 'RULE' }],
    ['chargeback in the text', 'LEGAL_SECURITY', { ticket: { body: 'I will file a chargeback with my bank.' } }, { level: 'SPECIALIST', source: 'RULE' }],
    ['safety in the text', 'LEGAL_SECURITY', { ticket: { body: 'The device overheated and my colleague was injured.' } }, { level: 'MANAGER', source: 'RULE' }],
    ['trusted model signal only', 'LEGAL_SECURITY', { classification: { signals: ['LEGAL_THREAT'], confidence: 0.6 } }, { level: 'MANAGER', source: 'LLM' }],
    ['model signal below 0.6 is ignored', 'LEGAL_SECURITY', { classification: { signals: ['LEGAL_THREAT'], confidence: 0.59 } }, null],
    ['model signal from a FALLBACK run is ignored', 'LEGAL_SECURITY', { classification: { signals: ['SECURITY_OR_DATA_BREACH'], outcome: 'FALLBACK' } }, null],
    ['keyword floor works even when the provider is down', 'LEGAL_SECURITY', { ticket: { body: 'Our lawyer will contact you.' }, classification: { outcome: 'FAILED', confidence: 0.3 } }, { level: 'MANAGER', source: 'RULE' }],
    ['REPEATED_CONTACT is not a legal/security signal', 'LEGAL_SECURITY', { classification: { signals: ['REPEATED_CONTACT'] } }, null],

    // VIP_CUSTOMER
    ['VIP with HIGH priority', 'VIP_CUSTOMER', { ticket: { customerTier: 'VIP', priority: 'HIGH' } }, { level: 'TIER2', source: 'RULE' }],
    ['VIP with URGENT priority', 'VIP_CUSTOMER', { ticket: { customerTier: 'VIP', priority: 'URGENT' } }, { level: 'TIER2', source: 'RULE' }],
    ['VIP with negative sentiment', 'VIP_CUSTOMER', { ticket: { customerTier: 'VIP' }, classification: { sentiment: 'NEGATIVE' } }, { level: 'TIER2', source: 'LLM' }],
    ['VIP, calm, MEDIUM', 'VIP_CUSTOMER', { ticket: { customerTier: 'VIP' } }, null],
    ['VIP, negative but untrusted classification', 'VIP_CUSTOMER', { ticket: { customerTier: 'VIP' }, classification: { sentiment: 'ANGRY', confidence: 0.4 } }, null],
    ['PREMIUM with URGENT priority', 'VIP_CUSTOMER', { ticket: { customerTier: 'PREMIUM', priority: 'URGENT' } }, null],

    // LOW_CONFIDENCE
    ['confidence 0.5', 'LOW_CONFIDENCE', { classification: { confidence: 0.5 } }, { level: 'TIER2', source: 'RULE' }],
    ['FALLBACK run', 'LOW_CONFIDENCE', { classification: { outcome: 'FALLBACK', confidence: 0.3 } }, { level: 'TIER2', source: 'RULE' }],
    ['confidence exactly 0.6', 'LOW_CONFIDENCE', { classification: { confidence: 0.6 } }, null],
    ['provider down (FAILED) is not low confidence', 'LOW_CONFIDENCE', { classification: { outcome: 'FAILED', confidence: 0.3 } }, null],
    ['no classification yet', 'LOW_CONFIDENCE', { classification: null }, null],

    // KB_GAP
    ['holding reply (not answerable)', 'KB_GAP', { draft: { answerable: false, outcome: 'VALID' } }, { level: 'TIER2', source: 'RULE' }],
    ['unusable model draft', 'KB_GAP', { draft: { answerable: false, outcome: 'FALLBACK' } }, { level: 'TIER2', source: 'RULE' }],
    ['grounded draft', 'KB_GAP', { draft: { answerable: true, outcome: 'VALID' } }, null],
    ['draft failed because the provider was down', 'KB_GAP', { draft: { answerable: false, outcome: 'FAILED' } }, null],
    ['no draft yet', 'KB_GAP', { draft: null }, null],

    // ANGRY_REPEAT
    ['angry + other recent tickets', 'ANGRY_REPEAT', { classification: { sentiment: 'ANGRY' }, recentCustomerTickets: 2 }, { level: 'MANAGER', source: 'LLM' }],
    ['angry + model REPEATED_CONTACT signal', 'ANGRY_REPEAT', { classification: { sentiment: 'ANGRY', signals: ['REPEATED_CONTACT'] } }, { level: 'MANAGER', source: 'LLM' }],
    ['angry + "third time" in the text', 'ANGRY_REPEAT', { classification: { sentiment: 'ANGRY' }, ticket: { body: 'This is the third time I write.' } }, { level: 'MANAGER', source: 'LLM' }],
    ['angry, first contact', 'ANGRY_REPEAT', { classification: { sentiment: 'ANGRY' } }, null],
    ['negative (not angry) repeat', 'ANGRY_REPEAT', { classification: { sentiment: 'NEGATIVE' }, recentCustomerTickets: 3 }, null],
    ['angry repeat but untrusted classification', 'ANGRY_REPEAT', { classification: { sentiment: 'ANGRY', confidence: 0.5 }, recentCustomerTickets: 1 }, null],

    // SLA_RISK (STANDARD = 24 h window, so the risk threshold is 6 h)
    ['due in 5 h', 'SLA_RISK', { ticket: { slaDueAt: hoursFromNow(5) } }, { level: 'TIER2', source: 'RULE' }],
    ['breached', 'SLA_RISK', { ticket: { slaDueAt: hoursFromNow(-1) } }, { level: 'TIER2', source: 'RULE' }],
    ['VIP due in 50 min (4 h window)', 'SLA_RISK', { ticket: { customerTier: 'VIP', slaDueAt: hoursFromNow(50 / 60) } }, { level: 'TIER2', source: 'RULE' }],
    ['VIP due in 2 h', 'SLA_RISK', { ticket: { customerTier: 'VIP', slaDueAt: hoursFromNow(2) } }, null],
    ['due in 7 h', 'SLA_RISK', { ticket: { slaDueAt: hoursFromNow(7) } }, null],
    ['breached but an agent already replied', 'SLA_RISK', { ticket: { slaDueAt: hoursFromNow(-1) }, hasAgentReply: true }, null],
    ['breached but waiting on the customer', 'SLA_RISK', { ticket: { slaDueAt: hoursFromNow(-1), status: 'WAITING_ON_CUSTOMER' } }, null],
    ['no SLA', 'SLA_RISK', { ticket: { slaDueAt: null } }, null],
  ];

  it('has cases for every rule', () => {
    expect(new Set(cases.map((c) => c[1]))).toEqual(new Set(ESCALATION_RULES));
  });

  it.each(cases)('%s → %s', (_name, rule, overrides, expected) => {
    const reasons = reasonsFor(rule, overrides);
    if (expected === null) {
      expect(reasons).toEqual([]);
    } else {
      expect(reasons).toEqual([expect.objectContaining({ rule, ...expected })]);
      expect(reasons[0].detail.length).toBeGreaterThan(0);
    }
  });

  it('keeps every triggered rule and lets the highest level win', () => {
    const result = evaluateEscalation(
      input({
        ticket: {
          customerTier: 'VIP',
          priority: 'URGENT',
          intent: 'TECHNICAL_ISSUE',
          body: 'Third time this month. Our lawyer is reviewing the contract.',
        },
        classification: { sentiment: 'ANGRY', signals: ['LEGAL_THREAT', 'REPEATED_CONTACT'] },
      }),
    );

    expect(result.recommended).toBe(true);
    expect(result.level).toBe('MANAGER');
    expect(result.triggeredRules).toEqual([
      'URGENT_PRIORITY',
      'LEGAL_SECURITY',
      'VIP_CUSTOMER',
      'ANGRY_REPEAT',
    ]);
    // The keyword match wins over the identical model signal: one reason per signal, source RULE.
    expect(result.reasons.filter((r) => r.rule === 'LEGAL_SECURITY')).toEqual([
      expect.objectContaining({ level: 'MANAGER', source: 'RULE' }),
    ]);
  });

  it('reports each high-stakes signal separately and takes the highest', () => {
    const result = evaluateEscalation(
      input({ ticket: { body: 'We were hacked and I will file a chargeback.' } }),
    );
    expect(result.reasons.map((r) => r.level)).toEqual(['SPECIALIST', 'SPECIALIST']);
    expect(result.triggeredRules).toEqual(['LEGAL_SECURITY']);
    expect(result.level).toBe('SPECIALIST');
  });

  it('orders levels NONE < TIER2 < SPECIALIST < MANAGER', () => {
    expect(LEVEL_RANK.NONE).toBeLessThan(LEVEL_RANK.TIER2);
    expect(LEVEL_RANK.TIER2).toBeLessThan(LEVEL_RANK.SPECIALIST);
    expect(LEVEL_RANK.SPECIALIST).toBeLessThan(LEVEL_RANK.MANAGER);
  });
});

describe('sameFindings', () => {
  it('ignores rule order', () => {
    expect(
      sameFindings(
        { level: 'TIER2', triggeredRules: ['KB_GAP', 'URGENT_PRIORITY'] },
        { level: 'TIER2', triggeredRules: ['URGENT_PRIORITY', 'KB_GAP'] },
      ),
    ).toBe(true);
  });

  it('differs when the level or the rule set changes', () => {
    const base = { level: 'TIER2' as const, triggeredRules: ['KB_GAP'] };
    expect(sameFindings(base, { level: 'MANAGER', triggeredRules: ['KB_GAP'] })).toBe(false);
    expect(sameFindings(base, { level: 'TIER2', triggeredRules: ['KB_GAP', 'SLA_RISK'] })).toBe(
      false,
    );
  });
});
