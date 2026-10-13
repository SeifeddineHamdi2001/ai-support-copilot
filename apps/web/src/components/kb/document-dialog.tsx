'use client';

import { useEffect, useRef } from 'react';
import { InlineError } from '@/components/inline-error';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { KB_STATUS_LABEL, dateTime } from '@/lib/format';
import { useKbDocument } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** A document's chunks as the retriever sees them. `highlightChunkId` comes from a draft citation. */
export function DocumentDialog({
  documentId,
  highlightChunkId,
  onClose,
}: {
  documentId: string | null;
  highlightChunkId: string | null;
  onClose: () => void;
}) {
  const doc = useKbDocument(documentId);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlightChunkId || !doc.data) return;
    // After the dialog's open animation has laid the list out.
    const t = setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-chunk-id="${highlightChunkId}"]`)
        ?.scrollIntoView({ block: 'center' });
    }, 50);
    return () => clearTimeout(t);
  }, [highlightChunkId, doc.data]);

  return (
    <Dialog open={!!documentId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4">
          <DialogTitle className="pr-8 text-[15px] font-semibold">
            {doc.data?.title ?? 'Document'}
          </DialogTitle>
          <DialogDescription className="text-xs" asChild>
            <div>
              {doc.data ? (
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="font-mono">{doc.data.slug}</span>
                  <span>{doc.data.category}</span>
                  <span>
                    {KB_STATUS_LABEL[doc.data.status]}, {doc.data.chunks.length} chunks
                  </span>
                  <span>Updated {dateTime(doc.data.updatedAt)}</span>
                </span>
              ) : (
                <Skeleton className="h-3 w-64" />
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {doc.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : doc.error ? (
            <InlineError error={doc.error} />
          ) : (
            <ol ref={listRef} className="flex flex-col gap-3" data-testid="kb-chunks">
              {doc.data.error && (
                <InlineError message={{ title: 'Indexing failed', detail: doc.data.error }} />
              )}
              {doc.data.chunks.map((c) => {
                const hit = c.id === highlightChunkId;
                return (
                  <li
                    key={c.id}
                    data-chunk-id={c.id}
                    aria-current={hit ? 'true' : undefined}
                    className={cn(
                      'border-border rounded-lg border',
                      hit && 'border-accent-ink/50 ring-accent-ink/15 ring-3',
                    )}
                  >
                    <div className="border-border flex items-baseline gap-3 border-b px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground tabular w-6 font-mono">
                        {c.ordinal}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {c.headingPath.split(' > ').join(' › ')}
                      </span>
                      {hit && <span className="text-accent-ink">Cited passage</span>}
                      <span
                        className="text-muted-foreground tabular font-mono"
                        title={c.embeddingModel ?? 'Not embedded'}
                      >
                        {c.tokenCount} tok
                      </span>
                    </div>
                    <p className="px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {c.content}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
