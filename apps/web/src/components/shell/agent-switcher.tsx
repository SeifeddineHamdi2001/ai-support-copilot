'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgent } from '@/lib/agent-context';
import { Avatar } from '../avatar';

const ROLE_LABEL = { AGENT: 'Agent', MANAGER: 'Manager', ADMIN: 'Admin' } as const;

export function AgentSwitcher({ compact = false }: { compact?: boolean }) {
  const { current, logout } = useAgent();

  if (!current) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5" data-testid="agent-switcher">
      <Avatar name={current.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{current.name}</span>
        {!compact && (
          <span className="text-muted-foreground block truncate text-xs">
            {ROLE_LABEL[current.role]}
          </span>
        )}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Sign out"
        title="Sign out"
        onClick={logout}
      >
        <LogOut />
      </Button>
    </div>
  );
}
