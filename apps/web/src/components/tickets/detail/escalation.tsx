'use client';

import { TICKET_TRANSITIONS } from '@copilot/shared';
import { toast } from 'sonner';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgent } from '@/lib/agent-context';
import { ApiError, describeError } from '@/lib/api';
import { ESCALATION_LEVEL_LABEL, ESCALATION_RULE_LABEL, relativeTime } from '@/lib/format';
import { useDecideEscalation, useEscalations, useEvaluateEscalation } from '@/lib/queries';
import type { Escalation, TicketDetail } from '@/lib/types';
import { Panel } from './panel';

/** The latest recommendation, if it still waits for an agent's decision. */
function pendingRecommendation(list: Escalation[] | undefined): Escalation | undefined {
  const latest = list?.[0];
  return latest?.recommended && latest.decision === 'PENDING' ? latest : undefined;
}

/** "just now" / "3h ago", for sentences. */
const ago = (iso: string) => {
  const r = relativeTime(iso);
  return r === 'now' ? 'just now' : r;
};

const canEscalate = (t: TicketDetail) => TICKET_TRANSITIONS[t.status].includes('ESCALATED');

/**
 * Shown above the conversation while a recommendation is pending. The system only recommends; the
 * agent accepts (ticket moves to ESCALATED) or dismisses it.
 */
export function EscalationBanner({
  ticket,
  onConflict,
}: {
  ticket: TicketDetail;
  onConflict: () => void;
}) {
  const { current } = useAgent();
  const escalations = useEscalations(ticket.id);
  const decide = useDecideEscalation(ticket, current?.id ?? null);
  const rec = pendingRecommendation(escalations.data);
  if (!rec || !canEscalate(ticket)) return null;

  const level = ESCALATION_LEVEL_LABEL[rec.level];
  const run = (decision: 'ACCEPTED' | 'DISMISSED') =>
    decide.mutate(
      { escalationId: rec.id, decision },
      {
        onSuccess: () =>
          toast.success(
            decision === 'ACCEPTED' ? `Escalated to ${level}` : 'Recommendation dismissed',
          ),
        onError: (err) => {
          if (err instanceof ApiError && err.isVersionConflict) return onConflict();
          // Superseded or already decided elsewhere: show the current state.
          void escalations.refetch();
          const { title, detail } = describeError(err);
          toast.error(title, { description: detail });
        },
      },
    );

  return (
    <section
      aria-labelledby="escalation-heading"
      data-testid="escalation-banner"
      className="border-status-escalated/25 bg-surface relative overflow-hidden rounded-xl border"
    >
      <span aria-hidden className="bg-status-escalated absolute inset-y-0 left-0 w-[3px]" />
      <div className="py-3 pr-3 pl-4">
        <h3 id="escalation-heading" className="font-semibold">
          Escalation recommended: <span className="text-status-escalated">{level}</span>
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {rec.reasons.length} rule{rec.reasons.length === 1 ? '' : 's'} triggered, raised{' '}
          {ago(rec.createdAt)}. The highest level applies.
        </p>
      </div>
      <ul className="border-border flex flex-col border-t" data-testid="escalation-reasons">
        {rec.reasons.map((r) => (
          <li
            key={r.rule}
            data-rule={r.rule}
            className="border-border grid grid-cols-[minmax(96px,160px)_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b py-1.5 pr-3 pl-4 text-xs last:border-b-0"
          >
            <span className="font-medium">{ESCALATION_RULE_LABEL[r.rule]}</span>
            <span className="text-foreground/80">
              {r.detail}
              {r.source === 'LLM' && <span className="text-muted-foreground"> (model signal)</span>}
            </span>
            <span className="text-muted-foreground whitespace-nowrap">
              {ESCALATION_LEVEL_LABEL[r.level]}
            </span>
          </li>
        ))}
      </ul>
      <footer className="border-border bg-surface-sunken/50 flex items-center justify-end gap-2 border-t py-2 pr-3 pl-4">
        <span className="text-muted-foreground mr-auto text-xs">
          Accepting moves the ticket to Escalated.
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => run('DISMISSED')}
          disabled={decide.isPending}
        >
          Dismiss
        </Button>
        <Button size="sm" onClick={() => run('ACCEPTED')} disabled={decide.isPending}>
          Escalate to {level}
        </Button>
      </footer>
    </section>
  );
}

/** Side-rail summary: what was last decided, and a way to re-run the rules. */
export function EscalationPanel({ ticket }: { ticket: TicketDetail }) {
  const { current } = useAgent();
  const escalations = useEscalations(ticket.id);
  const evaluate = useEvaluateEscalation(ticket.id, current?.id ?? null);
  const latest = escalations.data?.[0];
  const evaluable = canEscalate(ticket);

  const run = () =>
    evaluate.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          r.recommended
            ? `Escalation to ${ESCALATION_LEVEL_LABEL[r.level]} recommended`
            : 'No escalation needed',
        ),
    });

  return (
    <Panel
      title="Escalation"
      data-testid="escalation-panel"
      action={
        evaluable ? (
          <Button size="xs" variant="ghost" onClick={run} disabled={evaluate.isPending}>
            {evaluate.isPending ? 'Checking…' : latest ? 'Re-evaluate' : 'Evaluate'}
          </Button>
        ) : undefined
      }
    >
      {escalations.isPending ? (
        <Skeleton className="h-4 w-2/3" />
      ) : escalations.error ? (
        <InlineError error={escalations.error} />
      ) : (
        <p className="text-xs" data-testid="escalation-state">
          <EscalationSummary latest={latest} ticket={ticket} />
        </p>
      )}
      {evaluate.error && <InlineError className="mt-2" error={evaluate.error} />}
    </Panel>
  );
}

function EscalationSummary({
  latest,
  ticket,
}: {
  latest: Escalation | undefined;
  ticket: TicketDetail;
}) {
  if (!latest) return <span className="text-muted-foreground">Not evaluated yet.</span>;
  const level = ESCALATION_LEVEL_LABEL[latest.level];
  const by = latest.decidedBy ? ` by ${latest.decidedBy.name}` : '';
  const when = latest.decidedAt ? `, ${relativeTime(latest.decidedAt)}` : '';
  if (!latest.recommended) {
    return (
      <span className="text-muted-foreground">
        No rule triggered. Checked {ago(latest.createdAt)}.
      </span>
    );
  }
  switch (latest.decision) {
    case 'PENDING':
      return canEscalate(ticket) ? (
        <span>
          <span className="text-status-escalated font-medium">{level}</span> recommended, waiting
          for a decision.
        </span>
      ) : (
        <span className="text-muted-foreground">{level} was recommended.</span>
      );
    case 'ACCEPTED':
      return (
        <span>
          Escalated to <span className="font-medium">{level}</span>
          <span className="text-muted-foreground">
            {by}
            {when}.
          </span>
        </span>
      );
    case 'DISMISSED':
      return (
        <span className="text-muted-foreground">
          {level} recommendation dismissed{by}
          {when}.
        </span>
      );
  }
}
