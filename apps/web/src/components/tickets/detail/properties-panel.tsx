'use client';

import {
  TICKET_INTENTS,
  TICKET_PRIORITIES,
  type TicketIntent,
  type TicketPriority,
  type TicketStatus,
} from '@copilot/shared';
import { Avatar } from '@/components/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgent } from '@/lib/agent-context';
import { dateTime, INTENT_LABEL, relativeTime, STATUS_LABEL, TIER_LABEL } from '@/lib/format';
import type { TicketChange } from '@/lib/queries';
import type { TicketDetail } from '@/lib/types';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';
import { PRIORITY_SOURCE_LABEL, PriorityLabel, StatusIcon, StatusLabel } from '../badges';
import { Panel } from './panel';

const UNASSIGNED = 'unassigned';

interface Props {
  ticket: TicketDetail;
  onChange: (change: TicketChange) => void;
  pending: boolean;
}

export function PropertiesPanel({ ticket, onChange, pending }: Props) {
  const { agents, current } = useAgent();
  const now = useNow();
  const closed = ticket.status === 'CLOSED';
  const disabled = pending || closed || !current;

  const slaOverdue =
    ticket.slaDueAt && !ticket.resolvedAt && new Date(ticket.slaDueAt).getTime() < now;

  return (
    <Panel title="Properties">
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        <Row label="Status" htmlFor="prop-status">
          <Select
            value={ticket.status}
            onValueChange={(v) => onChange({ kind: 'status', status: v as TicketStatus })}
            disabled={disabled || ticket.allowedTransitions.length === 0}
          >
            <PropTrigger id="prop-status">
              <StatusLabel status={ticket.status} />
            </PropTrigger>
            <SelectContent position="popper">
              <SelectItem value={ticket.status} disabled>
                <StatusIcon status={ticket.status} />
                {STATUS_LABEL[ticket.status]}
              </SelectItem>
              <SelectSeparator />
              {ticket.allowedTransitions.map((s) => (
                <SelectItem key={s} value={s}>
                  <StatusIcon status={s} />
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Priority" htmlFor="prop-priority">
          <Select
            value={ticket.priority}
            onValueChange={(v) => onChange({ kind: 'priority', priority: v as TicketPriority })}
            disabled={disabled}
          >
            <PropTrigger id="prop-priority">
              <PriorityLabel priority={ticket.priority} />
              <span
                className="text-muted-foreground ml-auto pl-2 text-xs"
                data-testid="priority-source"
              >
                {PRIORITY_SOURCE_LABEL[ticket.prioritySource]}
              </span>
            </PropTrigger>
            <SelectContent position="popper">
              {[...TICKET_PRIORITIES].reverse().map((p) => (
                <SelectItem key={p} value={p}>
                  <PriorityLabel priority={p} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Intent" htmlFor="prop-intent">
          <Select
            value={ticket.intent ?? undefined}
            onValueChange={(v) => onChange({ kind: 'intent', intent: v as TicketIntent })}
            disabled={disabled}
          >
            <PropTrigger id="prop-intent">
              <SelectValue
                placeholder={<span className="text-subtle-foreground">Unclassified</span>}
              />
            </PropTrigger>
            <SelectContent position="popper">
              {TICKET_INTENTS.map((i) => (
                <SelectItem key={i} value={i}>
                  {INTENT_LABEL[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Assignee" htmlFor="prop-assignee">
          <Select
            value={ticket.assigneeId ?? UNASSIGNED}
            onValueChange={(v) =>
              onChange({ kind: 'assign', assigneeId: v === UNASSIGNED ? null : v })
            }
            disabled={disabled}
          >
            <PropTrigger id="prop-assignee">
              {ticket.assignee ? (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={ticket.assignee.name} className="size-5 text-[9.5px]" />
                  <span className="truncate">{ticket.assignee.name}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </PropTrigger>
            <SelectContent position="popper">
              {current && current.id !== ticket.assigneeId && (
                <>
                  <SelectItem value={current.id}>Assign to me</SelectItem>
                  <SelectSeparator />
                </>
              )}
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <Avatar name={a.name} className="size-5 text-[9.5px]" />
                  {a.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </dl>

      <dl className="border-border mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-2 border-t pt-3 text-xs">
        <dt className="text-muted-foreground">Customer</dt>
        <dd className="min-w-0">
          <span className="block truncate font-medium">{ticket.customer.name}</span>
          <span className="text-muted-foreground block truncate">{ticket.customer.email}</span>
        </dd>
        <dt className="text-muted-foreground">Tier</dt>
        <dd className={cn(ticket.customer.tier === 'VIP' && 'font-medium')}>
          {TIER_LABEL[ticket.customer.tier]}
        </dd>
        <dt className="text-muted-foreground">SLA due</dt>
        <dd className={cn('tabular font-mono', slaOverdue && 'text-danger font-medium')}>
          {ticket.resolvedAt ? (
            <span className="text-muted-foreground font-sans">Met (resolved)</span>
          ) : ticket.slaDueAt ? (
            <time dateTime={ticket.slaDueAt} title={dateTime(ticket.slaDueAt)}>
              {slaOverdue
                ? `overdue ${relativeTime(ticket.slaDueAt, now).replace(' ago', '')}`
                : relativeTime(ticket.slaDueAt, now)}
            </time>
          ) : (
            '—'
          )}
        </dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd className="tabular font-mono">{dateTime(ticket.createdAt)}</dd>
      </dl>

      {closed && (
        <p className="text-muted-foreground mt-3 text-xs">Closed tickets are read-only.</p>
      )}
    </Panel>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt>
        <label htmlFor={htmlFor} className="text-muted-foreground text-xs">
          {label}
        </label>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function PropTrigger({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <SelectTrigger
      id={id}
      className="hover:border-border hover:bg-surface-sunken data-[state=open]:border-border h-8 w-full border-transparent px-2 shadow-none [&>svg:last-child]:opacity-0 hover:[&>svg:last-child]:opacity-100"
    >
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
    </SelectTrigger>
  );
}
