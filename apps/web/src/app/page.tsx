import { TICKET_STATUSES } from '@copilot/shared';
import { ApiStatus } from '@/components/api-status';

// Phase 1 placeholder: proves the web app builds, imports @copilot/shared, and can reach the API.
// The support console (design tokens, app shell, ticket views) is built in Phase 4.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">Support Copilot</h1>
      <p className="text-muted-foreground text-sm">
        Scaffold is running. Ticket statuses from the shared package: {TICKET_STATUSES.join(', ')}.
      </p>
      <ApiStatus />
    </main>
  );
}
