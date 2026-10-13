import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KbView } from '@/components/kb/kb-view';

export const metadata: Metadata = { title: 'Knowledge base' };

export default function KnowledgeBasePage() {
  // The open document is read from the URL (?doc=&chunk=) on the client.
  return (
    <Suspense>
      <KbView />
    </Suspense>
  );
}
