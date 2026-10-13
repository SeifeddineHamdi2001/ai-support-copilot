'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { InlineError } from '@/components/inline-error';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useKbDocuments } from '@/lib/queries';
import { AddDocumentDialog } from './add-document-dialog';
import { DocumentDialog } from './document-dialog';
import { KbTable } from './kb-table';
import { SearchTester } from './search-tester';

export function KbView() {
  const docs = useKbDocuments();
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('doc');

  const open = (docId: string | null, chunkId?: string) => {
    const next = new URLSearchParams();
    if (docId) next.set('doc', docId);
    if (docId && chunkId) next.set('chunk', chunkId);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Knowledge base" count={docs.data?.length}>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add document
        </Button>
      </PageHeader>

      <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="Documents" className="min-w-0 overflow-x-auto">
          {docs.isPending ? (
            <div className="flex flex-col">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="border-border flex h-[42px] items-center gap-4 border-b px-5"
                >
                  <Skeleton className="h-3.5 w-64" />
                  <Skeleton className="ml-auto h-3.5 w-24" />
                </div>
              ))}
            </div>
          ) : docs.error ? (
            <div className="max-w-xl p-5">
              <InlineError
                error={docs.error}
                action={
                  <Button size="sm" variant="outline" onClick={() => docs.refetch()}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : docs.data.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-5">
              <p className="text-muted-foreground">
                No documents. Drafts can only answer from what is in the knowledge base.
              </p>
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                Add document
              </Button>
            </div>
          ) : (
            <KbTable documents={docs.data} onOpen={(id) => open(id)} />
          )}
        </section>

        <aside
          aria-label="Search tester"
          className="border-border border-t xl:border-t-0 xl:border-l"
        >
          <SearchTester onOpenChunk={open} />
        </aside>
      </div>

      <AddDocumentDialog
        open={adding}
        onOpenChange={setAdding}
        categories={[...new Set(docs.data?.map((d) => d.category))].sort()}
        onAdded={(id) => open(id)}
      />
      <DocumentDialog
        documentId={openId}
        highlightChunkId={params.get('chunk')}
        onClose={() => open(null)}
      />
    </main>
  );
}
