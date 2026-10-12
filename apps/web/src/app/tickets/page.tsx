import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TicketsView } from '@/components/tickets/tickets-view';

export const metadata: Metadata = { title: 'Inbox' };

export default function TicketsPage() {
  // Filters are read from the URL on the client; the boundary keeps the rest of the page prerenderable.
  return (
    <Suspense>
      <TicketsView />
    </Suspense>
  );
}
