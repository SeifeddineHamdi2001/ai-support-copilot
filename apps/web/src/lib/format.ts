import type {
  TicketChannel,
  TicketIntent,
  TicketPriority,
  TicketStatus,
  CustomerTier,
} from '@copilot/shared';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const INTENT_LABEL: Record<TicketIntent, string> = {
  BILLING: 'Billing',
  REFUND_REQUEST: 'Refund',
  TECHNICAL_ISSUE: 'Technical',
  BUG_REPORT: 'Bug report',
  ACCOUNT_ACCESS: 'Account access',
  FEATURE_REQUEST: 'Feature request',
  CANCELLATION: 'Cancellation',
  GENERAL_INQUIRY: 'General',
  OTHER: 'Other',
};

export const CHANNEL_LABEL: Record<TicketChannel, string> = {
  EMAIL: 'Email',
  WEB: 'Web form',
  CHAT: 'Chat',
  PHONE: 'Phone',
};

export const TIER_LABEL: Record<CustomerTier, string> = {
  VIP: 'VIP',
  PREMIUM: 'Premium',
  STANDARD: 'Standard',
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}

/** Compact relative time for tables and timelines: "now", "4m", "3h", "2d", then a short date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  let out: string;
  if (s < 45) return 'now';
  else if (s < 3600) out = `${Math.round(s / 60)}m`;
  else if (s < 86_400) out = `${Math.round(s / 3600)}h`;
  else if (s < 86_400 * 14) out = `${Math.round(s / 86_400)}d`;
  else return shortDate(iso);
  return future ? `in ${out}` : `${out} ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Time of day for timeline rows, e.g. "14:03". */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
