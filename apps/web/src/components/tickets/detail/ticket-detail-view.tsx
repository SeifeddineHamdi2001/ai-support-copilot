'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { InlineError } from '@/components/inline-error';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgent } from '@/lib/agent-context';
import { ApiError, describeError } from '@/lib/api';
import { PRIORITY_LABEL, STATUS_LABEL, INTENT_LABEL } from '@/lib/format';
import { useTicket, useUpdateTicket, type TicketChange } from '@/lib/queries';
import { ActivityTimeline } from './activity-timeline';
import { AiTriageCard } from './ai-triage-card';
import { DraftPanel } from './draft-panel';
import { EscalationBanner, EscalationPanel } from './escalation';
import { MessageThread } from './message-thread';
import { PropertiesPanel } from './properties-panel';

function successMessage(change: TicketChange, agentName: (id: string) => string): string {
  switch (change.kind) {
    case 'status':
      return `Status changed to ${STATUS_LABEL[change.status]}`;
    case 'assign':
      return change.assigneeId ? `Assigned to ${agentName(change.assigneeId)}` : 'Unassigned';
    case 'priority':
      return `Priority set to ${PRIORITY_LABEL[change.priority]}`;
    case 'intent':
      return `Intent set to ${INTENT_LABEL[change.intent]}`;
  }
}

export function TicketDetailView({ id }: { id: string }) {
  const { current, agents } = useAgent();
  const ticketQuery = useTicket(id);
  const ticket = ticketQuery.data;
  const update = useUpdateTicket(ticket, current?.id ?? null);
  const [conflict, setConflict] = useState(false);

  const agentName = (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? 'an agent';

  const apply = (change: TicketChange) => {
    update.mutate(change, {
      onSuccess: () => toast.success(successMessage(change, agentName)),
      onError: (err) => {
        if (err instanceof ApiError && err.isVersionConflict) setConflict(true);
        else {
          const { title, detail } = describeError(err);
          toast.error(title, { description: detail });
        }
      },
    });
  };

  const reload = async () => {
    await ticketQuery.refetch();
    setConflict(false);
  };

  if (ticketQuery.isPending) return <DetailSkeleton />;
  if (ticketQuery.error || !ticket) {
    const notFound = ticketQuery.error instanceof ApiError && ticketQuery.error.status === 404;
    return (
      <main className="flex-1">
        <PageHeader title={<Breadcrumb />} />
        <div className="max-w-xl p-5">
          {notFound ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted-foreground">This ticket does not exist or was removed.</p>
              <Button size="sm" variant="outline" asChild>
                <Link href="/tickets">Back to inbox</Link>
              </Button>
            </div>
          ) : (
            <InlineError
              error={ticketQuery.error}
              action={
                <Button size="sm" variant="outline" onClick={() => ticketQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <title>{`#${ticket.number} ${ticket.subject} · Relay`}</title>
      <PageHeader title={<Breadcrumb number={ticket.number} />} />

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Conversation" className="min-w-0 px-5 py-5 lg:px-8">
          <div className="mx-auto flex max-w-[760px] flex-col gap-5">
            <EscalationBanner ticket={ticket} onConflict={() => setConflict(true)} />
            <MessageThread ticket={ticket} />
            <DraftPanel ticket={ticket} />
          </div>
        </section>

        <aside
          aria-label="Ticket details"
          className="border-border flex flex-col gap-4 border-t px-4 py-4 lg:border-t-0 lg:border-l"
        >
          {conflict && (
            <InlineError
              message={{
                title: 'This ticket was updated by someone else',
                detail:
                  'Your change was not saved. Reload to see the latest version, then try again.',
              }}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={reload}
                  disabled={ticketQuery.isFetching}
                >
                  Reload
                </Button>
              }
            />
          )}
          <PropertiesPanel ticket={ticket} onChange={apply} pending={update.isPending} />
          <AiTriageCard ticket={ticket} />
          <EscalationPanel ticket={ticket} />
          <ActivityTimeline ticketId={ticket.id} />
        </aside>
      </div>
    </main>
  );
}

function Breadcrumb({ number }: { number?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <Link href="/tickets" className="text-muted-foreground hover:text-foreground font-normal">
        Inbox
      </Link>
      <span className="text-subtle-foreground font-normal">/</span>
      {number !== undefined && <span className="tabular font-mono text-[13px]">#{number}</span>}
    </span>
  );
}

function DetailSkeleton() {
  return (
    <main className="flex-1" aria-busy="true" aria-label="Loading ticket">
      <PageHeader title={<Breadcrumb />} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3 px-8 py-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-4 h-32 w-full" />
        </div>
        <div className="border-border flex flex-col gap-4 border-l px-4 py-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </main>
  );
}
