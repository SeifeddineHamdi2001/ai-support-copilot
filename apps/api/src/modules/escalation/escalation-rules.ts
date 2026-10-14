import {
  SLA_HOURS_BY_TIER,
  type AiOutcome,
  type CustomerTier,
  type EscalationLevel,
  type EscalationRule,
  type EscalationSignal,
  type Sentiment,
  type TicketIntent,
  type TicketPriority,
  type TicketStatus,
} from '@copilot/shared';
import { detectSignals } from '../ai/classification/keyword-classifier';

/**
 * Escalation rules engine (pure, no Nest, no DB, table-driven tests in escalation-rules.spec.ts).
 *
 * Deterministic rules on ticket data run first. Model output is one more input, and the model's signals
 * and sentiment only count when its classification is trusted: outcome VALID/REPAIRED and
 * confidence >= LLM_SIGNAL_MIN_CONFIDENCE. High-stakes signals (legal, breach, chargeback, safety) also
 * have a keyword floor, so they are caught when the model misses them or is down. Every triggered rule is
 * reported with its level and a reason; the highest level wins. The system only recommends: an agent
 * accepts or dismisses.
 */

/**
 * Central escalation rules tuning configuration.
 * Groups all thresholds, intent lists, and window parameters in one place for transparent tuning.
 */
export const ESCALATION_CONFIG = {
  /** Confidence floor for LLM classification signals to be trusted. */
  llmSignalMinConfidence: 0.6,
  /** Critical confidence floor: confidence at or below this indicates severe ambiguity/guesswork and escalates to TIER2 regardless of priority. */
  criticalConfidenceThreshold: 0.5,
  /** Borderline confidence threshold: confidence below this escalates to TIER2 only for HIGH or URGENT priority tickets. */
  borderlineConfidenceThreshold: 0.6,
  /** First-response SLA share: SLA_RISK fires when less than this share of the tier's window remains. */
  slaRiskRemainingShare: 0.25,
  /** Window for counting previous tickets by the same customer as repeat contact. */
  repeatContactWindowDays: 7,
  /** Customer tiers considered high-value for churn retention escalation. */
  highValueTiers: ['VIP', 'PREMIUM'] as const,
  /** Intents that touch financial decisions and always escalate to TIER2. */
  alwaysEscalateIntents: ['REFUND_REQUEST'] as const,
  /** Intents that escalate conditionally based on tier or sentiment (e.g. churn risk). */
  conditionalIntents: ['CANCELLATION'] as const,
  /** Technical intents for which a KB gap (missing resolution) warrants TIER2 escalation. */
  kbGapTechnicalIntents: ['TECHNICAL_ISSUE', 'BUG_REPORT'] as const,
};

export const LLM_SIGNAL_MIN_CONFIDENCE = ESCALATION_CONFIG.llmSignalMinConfidence;
/** Below this, the classification is not trusted to route the ticket on its own. */
export const LOW_CONFIDENCE_THRESHOLD = ESCALATION_CONFIG.borderlineConfidenceThreshold;
export const CRITICAL_CONFIDENCE_THRESHOLD = ESCALATION_CONFIG.criticalConfidenceThreshold;
/** SLA_RISK fires when less than this share of the tier's first-response window is left. */
export const SLA_RISK_REMAINING_SHARE = ESCALATION_CONFIG.slaRiskRemainingShare;
/** Other tickets from the same customer within this window count as repeat contact. */
export const REPEAT_CONTACT_WINDOW_DAYS = ESCALATION_CONFIG.repeatContactWindowDays;

export const LEVEL_RANK: Record<EscalationLevel, number> = {
  NONE: 0,
  TIER2: 1,
  SPECIALIST: 2,
  MANAGER: 3,
};

/** Intents that touch money or churn: refund approvals or retention offers. */
export const SENSITIVE_INTENTS: readonly TicketIntent[] = [
  ...ESCALATION_CONFIG.alwaysEscalateIntents,
  ...ESCALATION_CONFIG.conditionalIntents,
];

/** Who handles each high-stakes signal: legal and safety go to a manager, the rest to a specialist team. */
export const SIGNAL_LEVELS: Partial<Record<EscalationSignal, EscalationLevel>> = {
  LEGAL_THREAT: 'MANAGER',
  SAFETY: 'MANAGER',
  SECURITY_OR_DATA_BREACH: 'SPECIALIST',
  CHARGEBACK: 'SPECIALIST',
};

export interface EscalationInput {
  ticket: {
    subject: string;
    body: string;
    status: TicketStatus;
    priority: TicketPriority;
    intent: TicketIntent | null;
    slaDueAt: Date | null;
    customerTier: CustomerTier;
  };
  /** Latest classification run, if any. */
  classification: {
    outcome: AiOutcome;
    confidence: number;
    sentiment: Sentiment;
    signals: readonly string[];
  } | null;
  /** Latest draft, if any. */
  draft: { answerable: boolean; outcome: AiOutcome } | null;
  /** Other tickets from the same customer created within REPEAT_CONTACT_WINDOW_DAYS. */
  recentCustomerTickets: number;
  /** Whether an agent has already replied (first response sent, so the SLA no longer applies). */
  hasAgentReply: boolean;
  now: Date;
}

export type ReasonSource = 'RULE' | 'LLM';

export interface EscalationReason {
  rule: EscalationRule;
  level: Exclude<EscalationLevel, 'NONE'>;
  detail: string;
  /** RULE: decided from ticket data alone. LLM: relied on a trusted model signal. */
  source: ReasonSource;
}

export interface EscalationResult {
  recommended: boolean;
  level: EscalationLevel;
  triggeredRules: EscalationRule[];
  reasons: EscalationReason[];
}

type RuleFn = (input: EscalationInput, llm: TrustedModelView) => EscalationReason[];

/** What the engine may use from the model: nothing unless the run is trusted. */
interface TrustedModelView {
  trusted: boolean;
  sentiment: Sentiment | null;
  signals: ReadonlySet<string>;
}

function modelView(c: EscalationInput['classification']): TrustedModelView {
  const trusted =
    c !== null &&
    (c.outcome === 'VALID' || c.outcome === 'REPAIRED') &&
    c.confidence >= LLM_SIGNAL_MIN_CONFIDENCE;
  return {
    trusted,
    sentiment: trusted ? c.sentiment : null,
    signals: new Set(trusted ? c.signals : []),
  };
}

const RULES: Record<EscalationRule, RuleFn> = {
  URGENT_PRIORITY: ({ ticket }) =>
    ticket.priority === 'URGENT'
      ? [{ rule: 'URGENT_PRIORITY', level: 'TIER2', detail: 'Priority is URGENT.', source: 'RULE' }]
      : [],

  SENSITIVE_INTENT: ({ ticket }, llm) => {
    if (!ticket.intent) return [];

    // Always escalate refunds and billing disputes (policy and financial adjustments require Tier 2)
    if (
      ESCALATION_CONFIG.alwaysEscalateIntents.includes(
        ticket.intent as (typeof ESCALATION_CONFIG.alwaysEscalateIntents)[number],
      )
    ) {
      return [
        {
          rule: 'SENSITIVE_INTENT',
          level: 'TIER2',
          detail: 'Refund requests require an agent who can approve refunds or financial adjustments.',
          source: 'RULE',
        },
      ];
    }

    // Cancellations: treat as lower priority unless customer is frustrated (NEGATIVE/ANGRY)
    // or high-value (PREMIUM/VIP). Calm standard cancellations stay with Tier 1 for copilot retention drafting.
    if (
      ESCALATION_CONFIG.conditionalIntents.includes(
        ticket.intent as (typeof ESCALATION_CONFIG.conditionalIntents)[number],
      )
    ) {
      const isHighValue = ESCALATION_CONFIG.highValueTiers.includes(
        ticket.customerTier as (typeof ESCALATION_CONFIG.highValueTiers)[number],
      );
      if (isHighValue) {
        return [
          {
            rule: 'SENSITIVE_INTENT',
            level: 'TIER2',
            detail: `${ticket.customerTier} customer cancellation request requires Tier 2 retention intervention.`,
            source: 'RULE',
          },
        ];
      }

      const sentiment = llm.sentiment;
      if (sentiment === 'NEGATIVE' || sentiment === 'ANGRY') {
        return [
          {
            rule: 'SENSITIVE_INTENT',
            level: 'TIER2',
            detail: `Cancellation request with ${sentiment.toLowerCase()} sentiment requires Tier 2 retention intervention.`,
            source: 'LLM',
          },
        ];
      }

      // Calm cancellation for standard customer stays with Tier 1
      return [];
    }

    return [];
  },

  LEGAL_SECURITY: ({ ticket }, llm) => {
    const keyword = new Set(detectSignals(`${ticket.subject}\n${ticket.body}`));
    return (Object.keys(SIGNAL_LEVELS) as EscalationSignal[]).flatMap((signal) => {
      const byRule = keyword.has(signal);
      if (!byRule && !llm.signals.has(signal)) return [];
      return [
        {
          rule: 'LEGAL_SECURITY' as const,
          level: SIGNAL_LEVELS[signal] as EscalationReason['level'],
          detail: `${signal} detected ${byRule ? 'in the ticket text' : 'by the classifier'}.`,
          source: byRule ? ('RULE' as const) : ('LLM' as const),
        },
      ];
    });
  },

  VIP_CUSTOMER: ({ ticket }, llm) => {
    if (ticket.customerTier !== 'VIP') return [];
    if (ticket.priority === 'HIGH' || ticket.priority === 'URGENT') {
      return [
        {
          rule: 'VIP_CUSTOMER',
          level: 'TIER2',
          detail: `VIP customer with ${ticket.priority} priority.`,
          source: 'RULE',
        },
      ];
    }
    if (llm.sentiment === 'NEGATIVE' || llm.sentiment === 'ANGRY') {
      return [
        {
          rule: 'VIP_CUSTOMER',
          level: 'TIER2',
          detail: `VIP customer with ${llm.sentiment.toLowerCase()} sentiment.`,
          source: 'LLM',
        },
      ];
    }
    return [];
  },

  LOW_CONFIDENCE: ({ classification: c, ticket }) => {
    // FAILED means the provider was down: that is "no answer", not a low-confidence answer.
    if (!c || c.outcome === 'FAILED') return [];

    // Severe / critical low confidence (<= 0.5) or fallback: model output was unusable or pure guesswork.
    // Escalates to Tier 2 regardless of ticket priority.
    if (c.confidence <= ESCALATION_CONFIG.criticalConfidenceThreshold) {
      return [
        {
          rule: 'LOW_CONFIDENCE',
          level: 'TIER2',
          detail:
            c.outcome === 'FALLBACK'
              ? 'The model output was unusable; ticket triaged by keyword fallback with critical ambiguity.'
              : `Critical classification ambiguity: confidence ${c.confidence.toFixed(2)} is at or below ${ESCALATION_CONFIG.criticalConfidenceThreshold}.`,
          source: 'RULE',
        },
      ];
    }

    // Borderline confidence (< 0.6): escalates to Tier 2 only if ticket priority is HIGH or URGENT.
    // Normal/Low priority tickets remain with Tier 1 for human review of copilot drafts before sending.
    if (c.confidence < ESCALATION_CONFIG.borderlineConfidenceThreshold) {
      if (ticket.priority === 'HIGH' || ticket.priority === 'URGENT') {
        return [
          {
            rule: 'LOW_CONFIDENCE',
            level: 'TIER2',
            detail: `High-stakes ticket (${ticket.priority} priority) with borderline classification confidence (${c.confidence.toFixed(2)} < ${ESCALATION_CONFIG.borderlineConfidenceThreshold}).`,
            source: 'RULE',
          },
        ];
      }
      return [];
    }

    return [];
  },

  KB_GAP: ({ ticket, draft }) => {
    if (!draft || draft.answerable || draft.outcome === 'FAILED') return [];

    // Only escalate to Tier 2 if the ticket is a technical issue or bug report requiring a documented fix.
    // General inquiries, feature requests, or off-topic queries with a KB gap are normal and handled by Tier 1.
    const isTechnical =
      ticket.intent !== null &&
      ESCALATION_CONFIG.kbGapTechnicalIntents.includes(
        ticket.intent as (typeof ESCALATION_CONFIG.kbGapTechnicalIntents)[number],
      );

    if (isTechnical) {
      return [
        {
          rule: 'KB_GAP',
          level: 'TIER2',
          detail: `The knowledge base could not ground a resolution for technical issue (${ticket.intent}).`,
          source: 'RULE',
        },
      ];
    }

    return [];
  },

  ANGRY_REPEAT: ({ ticket, recentCustomerTickets }, llm) => {
    if (llm.sentiment !== 'ANGRY') return [];
    const repeat: string[] = [];
    if (recentCustomerTickets > 0) {
      repeat.push(
        `opened ${recentCustomerTickets} other ticket(s) in the last ${REPEAT_CONTACT_WINDOW_DAYS} days`,
      );
    }
    if (
      llm.signals.has('REPEATED_CONTACT') ||
      detectSignals(`${ticket.subject}\n${ticket.body}`).includes('REPEATED_CONTACT')
    ) {
      repeat.push('says they have contacted support before');
    }
    return repeat.length
      ? [
          {
            rule: 'ANGRY_REPEAT',
            level: 'MANAGER',
            detail: `Angry customer who ${repeat.join(' and ')}.`,
            source: 'LLM',
          },
        ]
      : [];
  },

  SLA_RISK: ({ ticket, hasAgentReply, now }) => {
    if (!ticket.slaDueAt || hasAgentReply) return [];
    if (ticket.status !== 'OPEN' && ticket.status !== 'IN_PROGRESS') return [];
    const remainingMs = ticket.slaDueAt.getTime() - now.getTime();
    const windowMs = SLA_HOURS_BY_TIER[ticket.customerTier] * 3_600_000;
    if (remainingMs > windowMs * SLA_RISK_REMAINING_SHARE) return [];
    const minutes = Math.round(Math.abs(remainingMs) / 60_000);
    return [
      {
        rule: 'SLA_RISK',
        level: 'TIER2',
        detail:
          remainingMs <= 0
            ? `First-response SLA breached ${minutes} min ago.`
            : `First-response SLA due in ${minutes} min with no agent reply.`,
        source: 'RULE',
      },
    ];
  },
};

/** Runs every rule; the highest level among the triggered ones is the recommendation. */
export function evaluateEscalation(input: EscalationInput): EscalationResult {
  const llm = modelView(input.classification);
  const reasons = (Object.keys(RULES) as EscalationRule[]).flatMap((rule) =>
    RULES[rule](input, llm),
  );
  const level = reasons.reduce<EscalationLevel>(
    (best, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[best] ? r.level : best),
    'NONE',
  );
  return {
    recommended: level !== 'NONE',
    level,
    triggeredRules: [...new Set(reasons.map((r) => r.rule))],
    reasons,
  };
}

/** Same findings (level and rule set) as an earlier evaluation, so no new recommendation is needed. */
type Findings = { level: EscalationLevel; triggeredRules: readonly string[] };

export function sameFindings(a: Findings, b: Findings): boolean {
  const key = (r: Findings) => `${r.level}|${[...r.triggeredRules].sort().join(',')}`;
  return key(a) === key(b);
}
