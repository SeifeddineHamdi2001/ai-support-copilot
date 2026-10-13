'use client';

import type { KbDocumentStatus } from '@copilot/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api';
import { KB_STATUS_LABEL, relativeTime } from '@/lib/format';
import { useDeleteKbDocument, useReindexKbDocument } from '@/lib/queries';
import type { KbDocument } from '@/lib/types';
import { cn } from '@/lib/utils';

const COLS = 'grid-cols-[minmax(0,1fr)_120px_64px_96px_80px_148px]';

const STATUS_DOT: Record<KbDocumentStatus, string> = {
  INDEXED: 'bg-status-resolved',
  PENDING: 'bg-status-waiting',
  FAILED: 'bg-danger',
};

const INGEST_MESSAGE = {
  created: 'Document added',
  updated: 'Document updated',
  unchanged: 'Already up to date',
  reembedded: 'Document re-indexed',
} as const;

export function KbTable({
  documents,
  onOpen,
}: {
  documents: KbDocument[];
  onOpen: (id: string) => void;
}) {
  return (
    <div role="table" aria-label="Documents" className="min-w-[720px]">
      <div
        role="row"
        className={cn(
          'border-border text-muted-foreground bg-background sticky top-0 z-10 grid h-8 items-center border-b px-5 text-xs',
          COLS,
        )}
      >
        {['Title', 'Category', 'Chunks', 'Status', 'Updated', ''].map((h, i) => (
          <span
            key={i}
            role="columnheader"
            className={cn((i === 2 || i === 4) && 'pr-4 text-right')}
          >
            {h}
          </span>
        ))}
      </div>
      <div role="rowgroup">
        {documents.map((d) => (
          <Row key={d.id} doc={d} onOpen={() => onOpen(d.id)} />
        ))}
      </div>
    </div>
  );
}

function Row({ doc, onOpen }: { doc: KbDocument; onOpen: () => void }) {
  const reindex = useReindexKbDocument();
  const remove = useDeleteKbDocument();
  const [confirming, setConfirming] = useState(false);

  // A pending delete confirmation expires so a stray second click later does not delete.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const onError = (err: unknown) => {
    const { title, detail } = describeError(err);
    toast.error(title, { description: detail });
  };

  return (
    <div
      role="row"
      data-testid="kb-row"
      className={cn(
        'border-border hover:bg-surface grid h-[42px] items-center border-b px-5',
        COLS,
      )}
    >
      <span role="cell" className="min-w-0 pr-4">
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-full truncate text-left leading-tight font-medium outline-none hover:underline focus-visible:underline"
        >
          {doc.title}
        </button>
        <span className="text-muted-foreground block truncate font-mono text-[11px] leading-tight">
          {doc.slug}
        </span>
      </span>
      <span role="cell" className="text-muted-foreground truncate pr-3">
        {doc.category}
      </span>
      <span role="cell" className="tabular pr-4 text-right font-mono text-xs">
        {doc.chunkCount}
      </span>
      <span
        role="cell"
        className="inline-flex items-center gap-1.5 text-xs"
        title={doc.error ?? undefined}
      >
        <span aria-hidden className={cn('size-[7px] rounded-full', STATUS_DOT[doc.status])} />
        <span className={cn(doc.status === 'FAILED' && 'text-danger font-medium')}>
          {KB_STATUS_LABEL[doc.status]}
        </span>
      </span>
      <time
        role="cell"
        dateTime={doc.updatedAt}
        className="text-muted-foreground tabular pr-4 text-right font-mono text-xs"
      >
        {relativeTime(doc.updatedAt)}
      </time>
      {/* Quiet until the row is hovered or focused, so ten rows of actions don't compete with the data. */}
      <span
        role="cell"
        className="text-muted-foreground group-focus-within:text-foreground group-hover:text-foreground flex justify-end gap-1"
      >
        <Button
          size="xs"
          variant="ghost"
          disabled={reindex.isPending}
          onClick={() =>
            reindex.mutate(doc.id, {
              onSuccess: (r) =>
                toast.success(INGEST_MESSAGE[r.status as keyof typeof INGEST_MESSAGE] ?? 'Done', {
                  description: `${doc.title}: ${r.chunks} chunks`,
                }),
              onError,
            })
          }
        >
          {reindex.isPending ? 'Reindexing…' : 'Reindex'}
        </Button>
        <Button
          size="xs"
          variant={confirming ? 'destructive' : 'ghost'}
          disabled={remove.isPending}
          aria-label={confirming ? `Confirm delete ${doc.title}` : `Delete ${doc.title}`}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            remove.mutate(doc.id, {
              onSuccess: () => toast.success(`Deleted ${doc.title}`),
              onError,
            });
          }}
        >
          {confirming ? 'Confirm' : 'Delete'}
        </Button>
      </span>
    </div>
  );
}

export { INGEST_MESSAGE };
