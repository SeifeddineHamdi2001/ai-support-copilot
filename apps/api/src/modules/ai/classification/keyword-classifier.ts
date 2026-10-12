import type {
  EscalationSignal,
  Sentiment,
  TicketClassification,
  TicketIntent,
  TicketPriority,
} from '@copilot/shared';

/**
 * Deterministic keyword classifier. It powers `MockLlmProvider` (so the app works with no API key) and is
 * the pipeline's fallback when a real model's output stays invalid. Rules are ordered: the first intent
 * whose patterns match wins. Always returns a value that passes TicketClassificationSchema.
 */

interface Rule<T> {
  value: T;
  patterns: RegExp[];
}

const INTENT_RULES: Rule<TicketIntent>[] = [
  {
    value: 'REFUND_REQUEST',
    patterns: [
      /\brefunds?\b/,
      /\bcharged twice\b/,
      /\b(double|duplicate) charges?\b/,
      /\bmoney back\b/,
      /\bchargeback\b/,
    ],
  },
  {
    value: 'CANCELLATION',
    patterns: [
      /\bcancel(l?ation|l?ing|led)?\b/,
      /\bdo not renew\b/,
      /\bstop (my|our) subscription\b/,
    ],
  },
  {
    value: 'ACCOUNT_ACCESS',
    patterns: [
      /\bpassword\b/,
      /\b2fa\b/,
      /\btwo[- ]factor\b/,
      /\bmfa\b/,
      /\blocked out\b/,
      /\blog ?in\b/,
      /\bsign ?in\b/,
      /\b(cannot|can't|unable to) access\b/,
      /\bbackup codes?\b/,
      // Compromised accounts are access incidents; the breach signal makes them URGENT.
      /\bhacked\b/,
      /\bunauthori[sz]ed (access|login)\b/,
      /\bcompromised\b/,
    ],
  },
  {
    value: 'TECHNICAL_ISSUE',
    patterns: [
      /\boutages?\b/,
      /\b(gone|is|are|went) down\b/,
      /\b50[0-4]\b/,
      /\btimes? out\b/,
      /\btimeouts?\b/,
      /\berrors?\b/,
      /\bnot loading\b/,
      /\bcrash(es|ed|ing)?\b/,
      /\bunreachable\b/,
    ],
  },
  {
    value: 'BUG_REPORT',
    patterns: [
      /\bbugs?\b/,
      /\bsteps( to reproduce)?:/,
      /\bcuts? off\b/,
      /\bbroken\b/,
      /\bwrong result/,
    ],
  },
  {
    value: 'BILLING',
    patterns: [
      /\binvoices?\b/,
      /\bbilling\b/,
      /\breceipts?\b/,
      /\bpayment method\b/,
      /\bvat\b/,
      /\bcharged?\b/,
    ],
  },
  {
    value: 'FEATURE_REQUEST',
    patterns: [
      /\bfeature request\b/,
      /\bwould (love|appreciate)\b/,
      /\bplease add\b/,
      /\bany plans\b/,
      /\bdark mode\b/,
      /\bwish\b/,
    ],
  },
  {
    value: 'GENERAL_INQUIRY',
    patterns: [
      /\bhow (do|can|long)\b/,
      /\bwhich plan\b/,
      /\bwhat are the\b/,
      /\bdoes acme\b/,
      /\bquestion\b/,
      /\bgdpr\b/,
      /\brate limits?\b/,
      /\bset ?up\b/,
      /\bsso\b/,
    ],
  },
];

/** Instructions aimed at the assistant rather than at support: classified on content, never obeyed. */
const INJECTION_PATTERNS = [
  /\bignore (all |any )?(previous|prior|above|your) (instructions|rules)\b/,
  /\b(system|your) prompt\b/,
  /\bset (the |my |this )?priority to\b/,
  /\byou are now\b/,
];

const URGENT_PATTERNS = [
  /\boutages?\b/,
  /\b(whole|entire) (team|company)\b/,
  /\beveryone\b/,
  /\ball (our )?users\b/,
  /\b50[0-4]\b/,
];
const HIGH_PATTERNS = [
  /\b(cannot|can't|unable to) (log ?in|access|sign ?in)\b/,
  /\blocked out\b/,
  /\bblock(ed|ing)\b/,
  /\bcharged twice\b/,
  /\b(double|duplicate) charges?\b/,
  /\bstolen\b/,
];
const MEDIUM_PATTERNS = [/\bgdpr\b/, /\bpersonal data\b/, /\bmonth end\b/, /\bdeadline\b/];

const SIGNAL_RULES: Rule<EscalationSignal>[] = [
  {
    value: 'LEGAL_THREAT',
    patterns: [/\blawyers?\b/, /\battorneys?\b/, /\blegal action\b/, /\bsue\b/, /\blawsuit\b/],
  },
  {
    value: 'SECURITY_OR_DATA_BREACH',
    patterns: [
      /\bbreach(ed)?\b/,
      /\bhacked\b/,
      /\bunauthori[sz]ed (access|login)\b/,
      /\bcompromised\b/,
      /\bleaked\b/,
    ],
  },
  { value: 'CHARGEBACK', patterns: [/\bchargebacks?\b/, /\bdispute (the|this) charge\b/] },
  {
    value: 'REPEATED_CONTACT',
    patterns: [
      /\b(second|third|fourth) time\b/,
      /\bwritten to (you|support) (twice|again|\d+ times)\b/,
      /\bnobody (has )?(called|replied|answered)\b/,
      /\bstill no (reply|response|answer)\b/,
    ],
  },
  { value: 'SAFETY', patterns: [/\binjur(y|ed)\b/, /\bunsafe\b/, /\bself[- ]harm\b/, /\bsuicid/] },
];

const ANGRY_PATTERNS = [
  /\blawyer\b/,
  /\bunacceptable\b/,
  /\bridiculous\b/,
  /\bfurious\b/,
  /\b(third|fourth) time\b/,
  /!{2,}/,
];
const NEGATIVE_PATTERNS = [
  /\b(cannot|can't|unable)\b/,
  /\berrors?\b/,
  /\bwrong\b/,
  /\bstolen\b/,
  /\bcharged twice\b/,
  /\bnever\b/,
  /\blost\b/,
  /\bproblem\b/,
  /\bfrustrat/,
  /\bbroken\b/,
  /\bblocking\b/,
  /\blocked out\b/,
  /\bcuts? off\b/,
];
const POSITIVE_PATTERNS = [
  /\blove\b/,
  /\bgreat\b/,
  /\bawesome\b/,
  /\bappreciate\b/,
  /\bthank you so much\b/,
];

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'my', 'to', 'please', 'you', 'have'],
  fr: ['le', 'la', 'les', 'et', 'est', 'mon', 'vous', 'pas', 'je'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'mein', 'bitte'],
  es: ['el', 'los', 'y', 'es', 'mi', 'no', 'por', 'favor', 'usted'],
};

const LOW_PRIORITY_INTENTS: TicketIntent[] = [
  'FEATURE_REQUEST',
  'GENERAL_INQUIRY',
  'OTHER',
  'CANCELLATION',
];

export function classifyByKeywords(subject: string, body: string): TicketClassification {
  const text = `${subject}\n${body}`.toLowerCase();
  const matches = (patterns: RegExp[]) => patterns.flatMap((p) => p.exec(text)?.[0] ?? []);
  const notes: string[] = [];

  const injection = matches(INJECTION_PATTERNS);
  let intent: TicketIntent = 'OTHER';
  let intentHits: string[] = [];
  for (const rule of INTENT_RULES) {
    const hits = matches(rule.patterns);
    if (hits.length) {
      intent = rule.value;
      intentHits = hits;
      break;
    }
  }
  notes.push(
    intentHits.length
      ? `${intent} from ${quote(intentHits)}`
      : 'no support topic recognised, so OTHER',
  );

  const escalationSignals = SIGNAL_RULES.filter((r) => matches(r.patterns).length).map(
    (r) => r.value,
  );

  let priority: TicketPriority;
  const urgent = matches(URGENT_PATTERNS);
  const high = matches(HIGH_PATTERNS);
  const medium = matches(MEDIUM_PATTERNS);
  if (
    (intent === 'TECHNICAL_ISSUE' && urgent.length) ||
    escalationSignals.includes('LEGAL_THREAT') ||
    escalationSignals.includes('SECURITY_OR_DATA_BREACH')
  ) {
    priority = 'URGENT';
    notes.push(`URGENT from ${quote(urgent.length ? urgent : escalationSignals)}`);
  } else if (high.length) {
    priority = 'HIGH';
    notes.push(`HIGH from ${quote(high)}`);
  } else if (medium.length || !LOW_PRIORITY_INTENTS.includes(intent)) {
    priority = 'MEDIUM';
  } else {
    priority = 'LOW';
  }

  let confidence = intentHits.length ? Math.min(0.9, 0.7 + 0.05 * (intentHits.length - 1)) : 0.6;
  if (injection.length) {
    // Never let the ticket lower its own priority, and send it to a human with low confidence.
    if (priority === 'LOW') priority = 'MEDIUM';
    confidence = 0.5;
    notes.push(`contains instructions to the assistant (${quote(injection)}), ignored`);
  }

  return {
    intent,
    priority,
    confidence,
    reasoning: `Keyword rules: ${notes.join('; ')}.`.slice(0, 400),
    sentiment: sentimentOf(matches),
    escalationSignals,
    language: languageOf(text),
  };
}

function sentimentOf(matches: (patterns: RegExp[]) => string[]): Sentiment {
  if (matches(ANGRY_PATTERNS).length) return 'ANGRY';
  if (matches(NEGATIVE_PATTERNS).length) return 'NEGATIVE';
  if (matches(POSITIVE_PATTERNS).length) return 'POSITIVE';
  return 'NEUTRAL';
}

function languageOf(text: string): string {
  const words = text.split(/[^\p{L}]+/u);
  let best = 'en';
  let bestScore = 0;
  for (const [lang, stop] of Object.entries(STOPWORDS)) {
    const score = words.filter((w) => stop.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [lang, score];
  }
  return best;
}

const quote = (hits: string[]) =>
  [...new Set(hits)]
    .slice(0, 3)
    .map((h) => `"${h}"`)
    .join(', ');
