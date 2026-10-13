'use client';

import { useEffect, useRef, useState } from 'react';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { score } from '@/lib/format';
import { useKbSearch } from '@/lib/queries';
import type { KbSearchHit } from '@/lib/types';
import { cn } from '@/lib/utils';

const EXAMPLES = ['I was charged twice this month', 'How do I reset two-factor login?'];

/**
 * Runs the same hybrid retrieval the drafts use (vector top 20 + full-text top 20, RRF k=60, top K,
 * similarity floor) and shows every score, so an agent can see why a passage was or was not used.
 */
export function SearchTester({
  onOpenChunk,
}: {
  onOpenChunk: (documentId: string, chunkId: string) => void;
}) {
  const search = useKbSearch();
  const [query, setQuery] = useState('');
  const [showBelow, setShowBelow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const result = search.data;

  // "/" focuses the query box, as in the inbox.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || t.closest('input, textarea, [contenteditable], [role="dialog"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = (q: string) => {
    if (q.trim().length < 2) return;
    setShowBelow(false);
    search.mutate(q.trim());
  };

  return (
    <div className="flex flex-col">
      <div className="border-border border-b px-4 py-3">
        <h2 className="text-[13px] font-semibold">Search tester</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          The retrieval drafts use: vector and full-text ranks fused with RRF, then a similarity
          floor.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(query);
          }}
        >
          <label htmlFor="kb-query" className="sr-only">
            Query
          </label>
          <Input
            ref={inputRef}
            id="kb-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Paste a customer question"
            autoComplete="off"
            maxLength={1000}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={search.isPending || query.trim().length < 2}
          >
            Search
          </Button>
        </form>
        {!result && !search.isPending && (
          <p className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            Try:
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                className="text-accent-ink hover:underline"
                onClick={() => {
                  setQuery(q);
                  run(q);
                }}
              >
                {q}
              </button>
            ))}
          </p>
        )}
      </div>

      {search.isPending ? (
        <div className="flex flex-col gap-3 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : search.error ? (
        <div className="p-4">
          <InlineError
            error={search.error}
            action={
              <Button size="xs" variant="outline" onClick={() => run(query)}>
                Retry
              </Button>
            }
          />
        </div>
      ) : result ? (
        <div data-testid="kb-search-results">
          <p className="text-muted-foreground border-border flex flex-wrap gap-x-4 gap-y-0.5 border-b px-4 py-2 text-xs">
            <span>
              Floor{' '}
              <span className="text-foreground tabular font-mono">
                {score(result.minSimilarity)}
              </span>
            </span>
            <span>
              Top <span className="text-foreground tabular font-mono">{result.topK}</span>
            </span>
            <span className="font-mono">{result.embeddingModel}</span>
          </p>
          {result.staleChunks > 0 && (
            <p className="border-border bg-warning-wash text-warning-ink border-b px-4 py-2 text-xs">
              {result.staleChunks} chunks were embedded with another model and are not searched.
              Reindex those documents.
            </p>
          )}

          {result.results.length === 0 ? (
            <p className="text-muted-foreground px-4 py-4">
              No passage passed the similarity floor. A draft for this question would be a holding
              reply.
            </p>
          ) : (
            <ol className="flex flex-col">
              {result.results.map((h, i) => (
                <Hit key={h.id} hit={h} rank={i + 1} onOpen={onOpenChunk} />
              ))}
            </ol>
          )}

          {result.belowFloor.length > 0 && (
            <div className="border-border border-t">
              <button
                type="button"
                aria-expanded={showBelow}
                onClick={() => setShowBelow((v) => !v)}
                className="text-muted-foreground hover:text-foreground w-full px-4 py-2 text-left text-xs"
              >
                {showBelow ? 'Hide' : 'Show'} {result.belowFloor.length} below the floor
              </button>
              {showBelow && (
                <ol className="flex flex-col opacity-70">
                  {result.belowFloor.map((h) => (
                    <Hit key={h.id} hit={h} onOpen={onOpenChunk} below />
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Hit({
  hit,
  rank,
  below,
  onOpen,
}: {
  hit: KbSearchHit;
  rank?: number;
  below?: boolean;
  onOpen: (documentId: string, chunkId: string) => void;
}) {
  const section = hit.headingPath.split(' > ').slice(1).join(' › ');
  return (
    <li className="border-border border-b last:border-b-0" data-testid="kb-hit">
      <button
        type="button"
        onClick={() => onOpen(hit.documentId, hit.id)}
        className="hover:bg-surface grid w-full grid-cols-[20px_minmax(0,1fr)] gap-x-2 px-4 py-2.5 text-left"
      >
        <span className="text-muted-foreground tabular pt-px font-mono text-xs">{rank ?? '-'}</span>
        <span className="min-w-0">
          <span className="block truncate">
            <span className="font-medium">{hit.title}</span>
            {section && <span className="text-muted-foreground"> › {section}</span>}
          </span>
          <span className="text-foreground/75 mt-0.5 line-clamp-2 text-xs leading-relaxed">
            {hit.content}
          </span>
          <span className="tabular mt-1.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
            <Metric
              label="sim"
              value={score(hit.similarity)}
              title="Cosine similarity to the query"
              strong
              warn={below}
            />
            <Metric
              label="rrf"
              value={score(hit.rrf, 4)}
              title="Reciprocal Rank Fusion score (k=60)"
            />
            <Metric
              label="vec"
              value={hit.semanticRank ? `#${hit.semanticRank}` : '-'}
              title="Rank in the vector top 20"
            />
            <Metric
              label="text"
              value={hit.lexicalRank ? `#${hit.lexicalRank}` : '-'}
              title="Rank in the full-text top 20"
            />
          </span>
        </span>
      </button>
    </li>
  );
}

function Metric({
  label,
  value,
  title,
  strong,
  warn,
}: {
  label: string;
  value: string;
  title: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <span title={title} className="whitespace-nowrap">
      <span className="text-subtle-foreground">{label} </span>
      <span className={cn(strong && 'text-foreground font-medium', warn && 'text-warning-ink')}>
        {value}
      </span>
    </span>
  );
}
