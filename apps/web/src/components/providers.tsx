'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api';
import { AgentProvider } from '@/lib/agent-context';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        // Client errors (404, 400) will not fix themselves; retry only network/5xx once.
        retry: (count, err) =>
          count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AgentProvider>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </AgentProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: '!rounded-[8px] !border-border !bg-surface !text-foreground !text-sm !shadow-sm',
            description: '!text-muted-foreground',
          },
        }}
      />
    </QueryClientProvider>
  );
}
