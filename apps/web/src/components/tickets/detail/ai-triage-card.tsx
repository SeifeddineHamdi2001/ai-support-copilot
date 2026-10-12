'use client';

import type { AiOutcome, Sentiment } from '@copilot/shared';
import { toast } from 'sonner';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgent } from '@/lib/agent-context';
import { INTENT_LABEL, relativeTime } from '@/lib/format';
import { useClassifications, useClassifyTicket } from '@/lib/queries';
import type { AiClassification, TicketDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PriorityLabel } from '../badges';
import { Panel } from './panel';

const OUTCOME_NOTE: Partial<Record<AiOutcome, { label: string; text: string }>> = {
  REPAIRED: { label: 'Repaired', text: 'The first answer was invalid; a repair call fixed it.' },
  FALLBACK: {
    label: 'Fallback',
    text: 'The model output was unusable, so keyword rules were used. Not applied to the ticket.',
  },
  FAILED: { label: 'Failed', text: 'The AI provider did not respond. The ticket is unchanged.' },
};

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative',
  ANGRY: 'Angry',
};

export function AiTriageCard({ ticket }: { ticket: TicketDetail }) {
  const { current } = useAgent();
  const runs = useClassifications(ticket.id);
  const classify = useClassifyTicket(ticket.id, current?.id ?? null);
  const latest = runs.data?.[0];
  const closed = ticket.status === 'CLOSED';

  const run = () =>
    classify.mutate(undefined, {
      onSuccess: ({ classification }) =>
        toast.success(
          classification.outcome === 'FALLBACK'
            ? 'Classified with fallback rules (not applied)'
            : `Classified as ${INTENT_LABEL[classification.intent]}`,
        ),
    });

  const needsRetry = latest && (latest.outcome === 'FAILED' || latest.outcome === 'FALLBACK');

  return (
    <Panel
      title="AI triage"
      caption={latest ? 'AI suggestion' : undefined}
      data-testid="ai-triage"
      action={
        latest && !closed ? (
          <Button size="xs" variant="ghost" onClick={run} disabled={classify.isPending}>
            {classify.isPending ? 'Classifying…' : needsRetry ? 'Retry' : 'Reclassify'}
          </Button>
        ) : undefined
      }
    >
      {runs.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : runs.error ? (
        <InlineError error={runs.error} />
      ) : !latest ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-xs">This ticket has not been classified yet.</p>
          {!closed && (
            <Button size="sm" variant="outline" onClick={run} disabled={classify.isPending}>
              {classify.isPending ? 'Classifying…' : 'Classify'}
            </Button>
          )}
        </div>
      ) : (
        <Classification c={latest} ticket={ticket} />
      )}

      {classify.error && (
        <InlineError
          className="mt-3"
          error={classify.error}
          action={
            <Button size="xs" variant="outline" onClick={run} disabled={classify.isPending}>
              Retry
            </Button>
          }
        />
      )}
    </Panel>
  );
}

function Classification({ c, ticket }: { c: AiClassification; ticket: TicketDetail }) {
  const note = OUTCOME_NOTE[c.outcome];
  const applied = c.outcome === 'VALID' || c.outcome === 'REPAIRED';
  const priorityKept =
    applied && ticket.prioritySource === 'MANUAL' && c.priority !== ticket.priority;
  const lowConfidence = c.confidence < 0.6;

  return (
    <div className="flex flex-col gap-2.5" data-outcome={c.outcome}>
      {c.outcome === 'FAILED' ? null : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium" data-testid="ai-intent">
              {INTENT_LABEL[c.intent]}
            </span>
            <PriorityLabel priority={c.priority} />
            <span className="text-muted-foreground text-xs">{SENTIMENT_LABEL[c.sentiment]}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[72px] shrink-0 text-xs">Confidence</span>
            <span
              role="meter"
              aria-label="Confidence"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={c.confidence}
              className="bg-surface-sunken h-1 flex-1 overflow-hidden rounded-full"
            >
              <span
                className={cn(
                  'block h-full rounded-full',
                  lowConfidence ? 'bg-priority-medium' : 'bg-accent-ink',
                )}
                style={{ width: `${Math.round(c.confidence * 100)}%` }}
              />
            </span>
            <span
              className={cn(
                'tabular w-8 text-right font-mono text-xs',
                lowConfidence && 'text-warning-ink',
              )}
            >
              {c.confidence.toFixed(2)}
            </span>
          </div>

          {/* Model text is shown as plain text, never as HTML. */}
          <p className="text-foreground/85 text-xs leading-relaxed">{c.reasoning}</p>

          {c.signals.length > 0 && (
            <p className="text-xs">
              <span className="text-muted-foreground">Signals: </span>
              {c.signals.map((s) => s.toLowerCase().replace(/_/g, ' ')).join(', ')}
            </p>
          )}
        </>
      )}

      {note && (
        <p
          className={cn(
            'rounded-md border px-2 py-1.5 text-xs',
            c.outcome === 'REPAIRED'
              ? 'border-border text-muted-foreground'
              : 'border-priority-medium/40 bg-warning-wash text-warning-ink',
          )}
        >
          <span className="font-medium">{note.label}.</span> {note.text}
        </p>
      )}
      {priorityKept && (
        <p className="text-muted-foreground text-xs">
          Priority not applied: an agent set it manually.
        </p>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <p className="text-subtle-foreground w-fit text-[11px]">
            {c.model}, {relativeTime(c.createdAt)}
          </p>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="font-mono text-[11px]">
          {c.provider} / {c.promptVersion} / {c.latencyMs} ms
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
