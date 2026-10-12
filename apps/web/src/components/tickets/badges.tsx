import type { PrioritySource, TicketIntent, TicketPriority, TicketStatus } from '@copilot/shared';
import { INTENT_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_COLOR: Record<TicketStatus, string> = {
  OPEN: 'text-status-open',
  IN_PROGRESS: 'text-status-progress',
  WAITING_ON_CUSTOMER: 'text-status-waiting',
  ESCALATED: 'text-status-escalated',
  RESOLVED: 'text-status-resolved',
  CLOSED: 'text-status-closed',
};

/**
 * Status glyph: each status has its own shape as well as its own color, so the list stays readable
 * without color (open ring, half-filled in progress, dashed waiting, ring with bar escalated, check resolved).
 */
export function StatusIcon({ status, className }: { status: TicketStatus; className?: string }) {
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true } as const;
  const cls = cn('shrink-0', STATUS_COLOR[status], className);
  switch (status) {
    case 'OPEN':
      return (
        <svg {...common} className={cls}>
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'IN_PROGRESS':
      return (
        <svg {...common} className={cls}>
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 2.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </svg>
      );
    case 'WAITING_ON_CUSTOMER':
      return (
        <svg {...common} className={cls}>
          <circle
            cx="6"
            cy="6"
            r="4.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="2.2 1.6"
          />
        </svg>
      );
    case 'ESCALATED':
      return (
        <svg {...common} className={cls}>
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M6 3.4v3.2M6 8.1v.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'RESOLVED':
      return (
        <svg {...common} className={cls}>
          <circle cx="6" cy="6" r="5.5" fill="currentColor" />
          <path
            d="M3.7 6.1l1.6 1.6 3-3.2"
            fill="none"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'CLOSED':
      return (
        <svg {...common} className={cls}>
          <circle cx="6" cy="6" r="5.5" fill="currentColor" />
          <path d="M4 6h4" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
  }
}

export function StatusLabel({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        status === 'ESCALATED' && 'text-status-escalated font-medium',
        className,
      )}
    >
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_DOT: Record<TicketPriority, string> = {
  URGENT: 'bg-priority-urgent',
  HIGH: 'bg-priority-high',
  MEDIUM: 'bg-priority-medium',
  LOW: 'bg-priority-low',
};

export function PriorityLabel({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        priority === 'URGENT' && 'text-priority-urgent font-medium',
        priority === 'LOW' && 'text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('size-[7px] shrink-0 rounded-full', PRIORITY_DOT[priority])}
      />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function IntentLabel({ intent }: { intent: TicketIntent | null }) {
  if (!intent) return <span className="text-subtle-foreground">Unclassified</span>;
  return (
    <span className="border-border bg-surface inline-flex h-5 items-center rounded-sm border px-1.5 text-xs whitespace-nowrap">
      {INTENT_LABEL[intent]}
    </span>
  );
}

/** Where the current priority came from: "AI", "Manual" or "Default". */
export const PRIORITY_SOURCE_LABEL: Record<PrioritySource, string> = {
  AI: 'Set by AI',
  MANUAL: 'Set manually',
  DEFAULT: 'Default',
};
