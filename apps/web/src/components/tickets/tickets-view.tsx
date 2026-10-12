'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { InlineError } from '@/components/inline-error';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PAGE_SIZE, useTickets } from '@/lib/queries';
import { NewTicketDialog } from './new-ticket-dialog';
import { TicketFiltersBar } from './ticket-filters-bar';
import { TicketTable, TicketTableSkeleton } from './ticket-table';
import { STATUS_TABS, useTicketFilters } from './use-ticket-filters';

export function TicketsView() {
  const { state, set, apiFilters, hasFilters } = useTicketFilters();
  const { data, error, isPending, isFetching, refetch } = useTickets(apiFilters);
  const [creating, setCreating] = useState(false);
  const tabLabel = STATUS_TABS.find((t) => t.key === state.tab)?.label ?? 'All';

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Inbox" count={data?.meta.total}>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New ticket
        </Button>
      </PageHeader>
      <TicketFiltersBar state={state} set={set} />

      <div className="flex-1 overflow-x-auto" aria-live="polite">
        {isPending ? (
          <TicketTableSkeleton />
        ) : error ? (
          <div className="p-5">
            <InlineError
              error={error}
              action={
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-5 py-10">
            <p className="text-muted-foreground">
              {hasFilters
                ? 'No tickets match these filters.'
                : state.tab === 'all'
                  ? 'No tickets yet.'
                  : `No ${tabLabel.toLowerCase()} tickets.`}
            </p>
            {hasFilters ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => set({ priority: 'any', intent: 'any', assignee: 'any', q: '' })}
              >
                Clear filters
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                New ticket
              </Button>
            )}
          </div>
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <TicketTable tickets={data.items} />
          </div>
        )}
      </div>

      {data && data.meta.total > 0 && (
        <footer className="border-border text-muted-foreground flex h-11 shrink-0 items-center justify-between border-t px-5 text-xs">
          <span className="tabular font-mono">
            {(data.meta.page - 1) * PAGE_SIZE + 1}–
            {Math.min(data.meta.page * PAGE_SIZE, data.meta.total)} of {data.meta.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous page"
              disabled={data.meta.page <= 1}
              onClick={() => set({ page: data.meta.page - 1 })}
            >
              <ChevronLeft />
            </Button>
            <span className="tabular px-1 font-mono">
              {data.meta.page} / {Math.max(1, data.meta.totalPages)}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next page"
              disabled={data.meta.page >= data.meta.totalPages}
              onClick={() => set({ page: data.meta.page + 1 })}
            >
              <ChevronRight />
            </Button>
          </div>
        </footer>
      )}

      <NewTicketDialog open={creating} onOpenChange={setCreating} />
    </main>
  );
}
