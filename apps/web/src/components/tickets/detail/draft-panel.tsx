'use client';

import type { AiOutcome } from '@copilot/shared';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgent } from '@/lib/agent-context';
import { describeError } from '@/lib/api';
import { splitDraft } from '@/lib/citations';
import { relativeTime, score } from '@/lib/format';
import { useDrafts, useGenerateDraft, useReviewDraft, type DraftReview } from '@/lib/queries';
import type { Draft, DraftCitation, TicketDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

const OUTCOME_NOTE: Partial<Record<AiOutcome, string>> = {
  REPAIRED: 'The first answer failed validation; a repair call fixed it.',
  FALLBACK: 'The model output was unusable, so this is the safe holding reply.',
  FAILED: 'The AI provider did not respond, so this is the safe holding reply.',
};

/**
 * Grounded reply draft for the ticket's latest customer message. The text is AI output, so it is
 * rendered as text nodes only; [S#] markers become buttons that select the matching source.
 */
export function DraftPanel({ ticket }: { ticket: TicketDetail }) {
  const { current } = useAgent();
  const actorId = current?.id ?? null;
  const drafts = useDrafts(ticket.id);
  const generate = useGenerateDraft(ticket.id, actorId);
  const latest = drafts.data?.[0];
  const closed = ticket.status === 'CLOSED';

  const run = () =>
    generate.mutate(undefined, {
      onSuccess: (d) =>
        toast.success(d.answerable ? 'Draft ready for review' : 'No grounded answer found'),
    });

  return (
    <section
      aria-labelledby="draft-heading"
      className="border-border bg-surface rounded-xl border"
      data-testid="draft-panel"
    >
      <header className="border-border flex h-11 items-center gap-2 border-b px-4">
        <h3 id="draft-heading" className="text-[13px] font-semibold">
          Reply draft
        </h3>
        {latest && <span className="text-muted-foreground text-xs">AI suggestion</span>}
        <div className="ml-auto flex items-center gap-2">
          {drafts.data && drafts.data.length > 1 && (
            <span className="text-subtle-foreground text-xs">{drafts.data.length - 1} earlier</span>
          )}
          {latest && !closed && (
            <Button size="xs" variant="ghost" onClick={run} disabled={generate.isPending}>
              {generate.isPending ? 'Drafting…' : 'Regenerate'}
            </Button>
          )}
        </div>
      </header>

      {generate.isPending || drafts.isPending ? (
        <DraftSkeleton />
      ) : drafts.error ? (
        <div className="p-4">
          <InlineError
            error={drafts.error}
            action={
              <Button size="xs" variant="outline" onClick={() => drafts.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : !latest ? (
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <p className="text-muted-foreground">
            {closed
              ? 'This ticket is closed.'
              : 'Draft a reply from the knowledge base. Nothing is sent until you approve it.'}
          </p>
          {!closed && (
            <Button size="sm" onClick={run}>
              Generate draft
            </Button>
          )}
        </div>
      ) : (
        <DraftBody key={latest.id} draft={latest} ticket={ticket} actorId={actorId} />
      )}

      {generate.error && (
        <div className="px-4 pb-4">
          <InlineError
            error={generate.error}
            action={
              <Button size="xs" variant="outline" onClick={run}>
                Retry
              </Button>
            }
          />
        </div>
      )}
    </section>
  );
}

function DraftBody({
  draft,
  ticket,
  actorId,
}: {
  draft: Draft;
  ticket: TicketDetail;
  actorId: string | null;
}) {
  const review = useReviewDraft(ticket.id, actorId);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.content);
  const sourcesRef = useRef<HTMLOListElement>(null);

  const labels = useMemo(() => new Set(draft.citations.map((c) => c.label)), [draft.citations]);
  const segments = useMemo(() => splitDraft(draft.content, labels), [draft.content, labels]);
  const reviewable = draft.status === 'DRAFT' && ticket.status !== 'CLOSED';
  const note = OUTCOME_NOTE[draft.outcome];

  const select = (label: string) => {
    setSelected((cur) => (cur === label ? null : label));
    sourcesRef.current
      ?.querySelector(`[data-label="${label}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const submit = (r: DraftReview) =>
    review.mutate(
      { draftId: draft.id, review: r },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(
            r.status === 'APPROVED' ? 'Reply added to the conversation' : 'Draft rejected',
          );
        },
        onError: (err) => {
          const { title, detail } = describeError(err);
          toast.error(title, { description: detail });
        },
      },
    );

  return (
    <div data-draft-status={draft.status} data-answerable={draft.answerable}>
      {!draft.answerable && <NoGroundedAnswer draft={draft} />}

      <div className="px-4 py-4">
        {!draft.answerable && <p className="text-muted-foreground mb-1.5 text-xs">Holding reply</p>}
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="draft-edit" className="sr-only">
              Reply text
            </label>
            <Textarea
              id="draft-edit"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(16, Math.max(6, text.split('\n').length + 1))}
              className="text-[13.5px] leading-relaxed"
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Source markers such as [S1] are removed from the reply the customer receives.
            </p>
          </div>
        ) : (
          <p
            className={cn(
              'text-[13.5px] leading-relaxed break-words whitespace-pre-wrap',
              draft.status === 'REJECTED' && 'text-muted-foreground',
            )}
            data-testid="draft-content"
          >
            {segments.map((s, i) =>
              s.kind === 'text' ? (
                s.text
              ) : (
                <span key={i} className="whitespace-nowrap">
                  {s.word}
                  {s.labels.map((label) => (
                    <CitationChip
                      key={label}
                      label={label}
                      active={selected === label}
                      onClick={() => select(label)}
                      citation={draft.citations.find((c) => c.label === label)!}
                    />
                  ))}
                </span>
              ),
            )}
          </p>
        )}
        {note && <p className="text-muted-foreground mt-3 text-xs">{note}</p>}
      </div>

      {draft.citations.length > 0 && (
        <div className="border-border border-t px-4 pt-3 pb-4">
          <h4 className="text-muted-foreground mb-2 text-xs font-medium">
            Sources
            <span className="text-subtle-foreground tabular ml-1.5 font-mono font-normal">
              {draft.citations.length}
            </span>
          </h4>
          <ol ref={sourcesRef} className="flex flex-col gap-1" data-testid="draft-sources">
            {draft.citations.map((c) => (
              <SourceItem
                key={c.id}
                citation={c}
                open={selected === c.label}
                onToggle={() => setSelected((cur) => (cur === c.label ? null : c.label))}
              />
            ))}
          </ol>
        </div>
      )}

      <footer className="border-border bg-surface-sunken/50 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t px-4 py-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            {draft.answerable ? (
              <span className="text-muted-foreground text-xs">
                Confidence{' '}
                <span className="text-foreground tabular font-mono">{score(draft.confidence)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">No sources cited</span>
            )}
          </TooltipTrigger>
          <TooltipContent side="top" className="font-mono text-[11px]">
            {draft.provider} / {draft.model} / {draft.promptVersion} / {draft.latencyMs} ms
          </TooltipContent>
        </Tooltip>

        {draft.status === 'DRAFT' ? (
          <span className="text-subtle-foreground text-xs">
            Drafted {relativeTime(draft.createdAt)}
          </span>
        ) : (
          <span className="text-xs" data-testid="draft-review-state">
            <span
              className={cn(
                'font-medium',
                draft.status === 'APPROVED' ? 'text-status-resolved' : 'text-muted-foreground',
              )}
            >
              {draft.status === 'APPROVED' ? 'Approved' : 'Rejected'}
            </span>
            <span className="text-muted-foreground">
              {draft.reviewedBy && ` by ${draft.reviewedBy.name}`}
              {draft.reviewedAt && `, ${relativeTime(draft.reviewedAt)}`}
            </span>
          </span>
        )}

        {reviewable && (
          <div className="ml-auto flex items-center gap-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setText(draft.content);
                  }}
                  disabled={review.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => submit({ status: 'APPROVED', content: text })}
                  disabled={review.isPending || !text.trim()}
                >
                  Approve and add reply
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => submit({ status: 'REJECTED' })}
                  disabled={review.isPending}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  disabled={review.isPending}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  onClick={() => submit({ status: 'APPROVED' })}
                  disabled={review.isPending}
                >
                  Approve and add reply
                </Button>
              </>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}

function NoGroundedAnswer({ draft }: { draft: Draft }) {
  return (
    <div
      className="border-border-strong bg-surface-sunken/60 mx-4 mt-4 rounded-lg border px-3 py-2.5"
      role="status"
      data-testid="no-grounded-answer"
    >
      <p className="font-medium">No grounded answer. Review manually.</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        The knowledge base does not cover this ticket well enough to answer it. The holding reply
        below makes no claims; edit it or write your own.
      </p>
      {draft.missingInformation.length > 0 && (
        <div className="mt-2 text-xs">
          <p className="text-muted-foreground">Missing from the knowledge base:</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {draft.missingInformation.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CitationChip({
  label,
  citation,
  active,
  onClick,
}: {
  label: string;
  citation: DraftCitation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Source ${label}: ${citation.document.title}`}
      title={citation.document.title}
      className={cn(
        'relative top-[-0.45em] ml-0.5 inline-flex h-3.75 items-center rounded-[3px] border px-0.75 align-baseline font-mono text-[10px] leading-none font-medium transition-colors',
        active
          ? 'border-accent-ink bg-accent-ink text-accent-ink-foreground'
          : 'border-accent-ink/25 bg-accent-wash text-accent-ink hover:border-accent-ink/60',
      )}
    >
      {label}
    </button>
  );
}

/** Heading path without the leading document title, which is already shown. */
function sectionPath(c: DraftCitation): string | null {
  const path = c.chunk?.headingPath;
  if (!path) return null;
  const parts = path.split(' > ');
  if (parts[0] === c.document.title) parts.shift();
  return parts.length ? parts.join(' › ') : null;
}

function SourceItem({
  citation: c,
  open,
  onToggle,
}: {
  citation: DraftCitation;
  open: boolean;
  onToggle: () => void;
}) {
  const section = sectionPath(c);
  const panelId = `source-${c.id}`;
  return (
    <li
      data-label={c.label}
      className={cn(
        'rounded-md border border-transparent transition-colors',
        open && 'border-accent-ink/30 bg-accent-wash/60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="hover:bg-surface-sunken/70 grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left"
      >
        <span className="text-accent-ink font-mono text-[11px] font-medium">{c.label}</span>
        <span className="min-w-0">
          <span className="font-medium">{c.document.title}</span>
          {section && <span className="text-muted-foreground"> › {section}</span>}
          {c.quote && (
            <span className="text-foreground/75 mt-0.5 block text-xs leading-relaxed">
              “{c.quote}”
            </span>
          )}
        </span>
        <span
          className="text-muted-foreground tabular font-mono text-[11px]"
          title="Cosine similarity to the ticket"
        >
          {score(c.score)}
        </span>
      </button>

      {open && (
        <div id={panelId} className="px-2 pb-2 pl-11">
          {c.chunk ? (
            <p className="border-border bg-surface max-h-64 overflow-auto rounded-md border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
              {c.chunk.content}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              This passage was replaced by a re-index. The quote above is what was cited.
            </p>
          )}
          <Link
            href={`/kb?doc=${c.documentId}${c.chunkId ? `&chunk=${c.chunkId}` : ''}`}
            className="text-accent-ink mt-1.5 inline-block text-xs hover:underline"
          >
            Open document
          </Link>
        </div>
      )}
    </li>
  );
}

function DraftSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 py-4" aria-busy="true" aria-label="Drafting reply">
      <Skeleton className="h-3.5 w-11/12" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="mt-3 h-10 w-full" />
    </div>
  );
}
