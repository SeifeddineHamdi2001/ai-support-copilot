'use client';

import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgent } from '@/lib/agent-context';
import { initials } from '@/lib/format';
import { Avatar } from '../avatar';

const ROLE_LABEL = { AGENT: 'Agent', LEAD: 'Team lead', ADMIN: 'Admin' } as const;

/** Picks which seeded agent the console acts as. No auth in scope; the choice is sent as X-User-Id. */
export function AgentSwitcher({ compact = false }: { compact?: boolean }) {
  const { agents, current, setCurrent, isLoading } = useAgent();

  if (isLoading) return <Skeleton className="h-10 w-full" />;
  if (!current) return <p className="text-muted-foreground px-2 text-xs">No agents found</p>;

  return (
    <Select value={current.id} onValueChange={setCurrent}>
      <SelectTrigger
        aria-label="Acting agent"
        data-testid="agent-switcher"
        className="hover:bg-border/60 h-auto w-full border-transparent px-2 py-1.5 shadow-none"
      >
        <span className="flex min-w-0 items-center gap-2 text-left">
          <Avatar name={current.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{current.name}</span>
            {!compact && (
              <span className="text-muted-foreground block truncate text-xs">
                {ROLE_LABEL[current.role]}
              </span>
            )}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent position="popper" side="top" align="start" className="w-[204px]">
        {agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            <span className="bg-border text-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-medium">
              {initials(a.name)}
            </span>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
