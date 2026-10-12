'use client';

import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgent } from '@/lib/agent-context';
import { clockTime, dateTime, shortDate } from '@/lib/format';
import { useTicketEvents } from '@/lib/queries';
import { describeEvent } from '@/lib/timeline';
import type { TicketEvent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Panel } from './panel';

/** Marker per actor kind: agents a filled dot, the AI a hollow diamond, the system a small square. */
function ActorMark({ type }: { type: TicketEvent['actorType'] }) {
  return (
    <span
      aria-hidden
      className="bg-surface relative z-10 flex size-3.5 items-center justify-center"
    >
      {type === 'USER' && <span className="bg-foreground/70 size-[7px] rounded-full" />}
      {type === 'AI' && <span className="border-accent-ink size-[7px] rotate-45 border-[1.5px]" />}
      {type === 'SYSTEM' && <span className="bg-subtle-foreground size-[6px] rounded-[1px]" />}
    </span>
  );
}

export function ActivityTimeline({ ticketId }: { ticketId: string }) {
  const { agents } = useAgent();
  const events = useTicketEvents(ticketId);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? 'an agent';

  return (
    <Panel title="Activity" caption={events.data ? events.data.length : undefined}>
      {events.isPending ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </div>
      ) : events.error ? (
        <InlineError
          error={events.error}
          action={
            <Button size="xs" variant="outline" onClick={() => events.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <ol className="relative flex flex-col gap-2.5" data-testid="timeline">
          {/* Spine connecting the markers. */}
          <span aria-hidden className="bg-border absolute top-1.5 bottom-1.5 left-[6.5px] w-px" />
          {events.data.map((e, i) => {
            const entry = describeEvent(e, agentName);
            const prev = events.data[i - 1];
            const newDay = !prev || shortDate(prev.createdAt) !== shortDate(e.createdAt);
            return (
              <li key={e.id} className="flex gap-2.5" data-event-type={e.type}>
                <span className="pt-[3px]">
                  <ActorMark type={e.actorType} />
                </span>
                <div className="min-w-0 flex-1 text-xs leading-snug">
                  <p>
                    <span className={cn('font-medium', e.actorType === 'AI' && 'text-accent-ink')}>
                      {entry.actor}
                    </span>{' '}
                    <span className="text-foreground/80">{entry.text}</span>
                  </p>
                  {entry.detail && <p className="text-muted-foreground mt-0.5">{entry.detail}</p>}
                </div>
                <time
                  dateTime={e.createdAt}
                  title={dateTime(e.createdAt)}
                  className="text-subtle-foreground tabular shrink-0 pt-px font-mono text-[11px]"
                >
                  {newDay ? `${shortDate(e.createdAt)} ` : ''}
                  {clockTime(e.createdAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
