'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeTime, TIER_LABEL } from '@/lib/format';
import type { Ticket } from '@/lib/types';
import { cn } from '@/lib/utils';
import { IntentLabel, PriorityLabel, StatusLabel } from './badges';

const COLS = 'grid-cols-[72px_minmax(0,1fr)_128px_96px_116px_72px_76px]';

function HeaderRow() {
  return (
    <div
      role="row"
      className={cn(
        'border-border text-muted-foreground sticky top-0 z-10 grid h-8 items-center border-b bg-background px-5 text-xs',
        COLS,
      )}
    >
      {['#', 'Subject', 'Intent', 'Priority', 'Status', 'Assignee', 'Updated'].map((h, i) => (
        <span key={h} role="columnheader" className={cn(i === 6 && 'text-right')}>
          {h}
        </span>
      ))}
    </div>
  );
}

export function TicketTable({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  return (
    <div role="table" aria-label="Tickets" className="min-w-[760px]">
      <HeaderRow />
      <div role="rowgroup">
        {tickets.map((t) => (
          <div
            key={t.id}
            role="row"
            data-testid="ticket-row"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('a')) router.push(`/tickets/${t.id}`);
            }}
            className={cn(
              'border-border hover:bg-surface grid h-[42px] cursor-pointer items-center border-b px-5',
              COLS,
            )}
          >
            <span role="cell" className="text-muted-foreground tabular font-mono text-xs">
              {t.number}
            </span>
            <span role="cell" className="min-w-0 pr-4">
              <Link
                href={`/tickets/${t.id}`}
                className="block truncate leading-tight font-medium outline-none hover:underline focus-visible:underline"
              >
                {t.subject}
              </Link>
              <span className="text-muted-foreground block truncate text-xs leading-tight">
                {t.customer.name}
                {t.customer.company && ` · ${t.customer.company}`}
                {t.customer.tier !== 'STANDARD' && (
                  <span className="text-foreground ml-1.5 font-medium">
                    {TIER_LABEL[t.customer.tier]}
                  </span>
                )}
              </span>
            </span>
            <span role="cell">
              <IntentLabel intent={t.intent} />
            </span>
            <span role="cell">
              <PriorityLabel priority={t.priority} />
            </span>
            <span role="cell">
              <StatusLabel status={t.status} />
            </span>
            <span role="cell">
              <span className="sr-only">{t.assignee?.name ?? 'Unassigned'}</span>
              {t.assignee ? (
                <Avatar name={t.assignee.name} />
              ) : (
                <span
                  aria-hidden
                  className="border-border-strong inline-block size-6 rounded-full border border-dashed"
                />
              )}
            </span>
            <span
              role="cell"
              className="text-muted-foreground tabular text-right font-mono text-xs"
            >
              <time dateTime={t.updatedAt} title={new Date(t.updatedAt).toLocaleString()}>
                {relativeTime(t.updatedAt)}
              </time>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TicketTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="min-w-[760px]" aria-busy="true" aria-label="Loading tickets">
      <HeaderRow />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('border-border grid h-[42px] items-center border-b px-5', COLS)}>
          <Skeleton className="h-3 w-8" />
          <span className="flex flex-col gap-1.5 pr-8">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </span>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="ml-auto h-3 w-10" />
        </div>
      ))}
    </div>
  );
}
