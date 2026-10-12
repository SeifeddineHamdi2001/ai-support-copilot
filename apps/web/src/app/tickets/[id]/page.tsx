import { TicketDetailView } from '@/components/tickets/detail/ticket-detail-view';

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketDetailView id={id} />;
}
