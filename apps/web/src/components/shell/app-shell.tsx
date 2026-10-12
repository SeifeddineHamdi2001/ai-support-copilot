'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AgentSwitcher } from './agent-switcher';

const NAV = [{ href: '/tickets', label: 'Inbox', icon: Inbox }];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh">
      <aside className="border-border bg-surface-sunken/60 sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r md:flex">
        <div className="flex h-12 items-center px-4">
          <Link href="/tickets" className="text-[15px] font-semibold tracking-tight">
            Relay
          </Link>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-px px-2 py-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-muted-foreground hover:bg-border/60 hover:text-foreground flex h-8 items-center gap-2 rounded-md px-2',
                  active && 'bg-border/70 text-foreground font-medium',
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-border mt-auto border-t p-2">
          <AgentSwitcher />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-border bg-surface flex h-12 items-center justify-between border-b px-4 md:hidden">
          <Link href="/tickets" className="text-[15px] font-semibold tracking-tight">
            Relay
          </Link>
          <div className="w-48">
            <AgentSwitcher compact />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
