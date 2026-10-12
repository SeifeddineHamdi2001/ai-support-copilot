'use client';

import type { TicketStatus } from '@copilot/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { TicketFilters } from '@/lib/queries';

/** Status tabs of the inbox. "Resolved" also shows closed tickets. */
export const STATUS_TABS: { key: string; label: string; statuses: TicketStatus[] | null }[] = [
  { key: 'open', label: 'Open', statuses: ['OPEN'] },
  { key: 'in_progress', label: 'In progress', statuses: ['IN_PROGRESS'] },
  { key: 'waiting', label: 'Waiting', statuses: ['WAITING_ON_CUSTOMER'] },
  { key: 'escalated', label: 'Escalated', statuses: ['ESCALATED'] },
  { key: 'resolved', label: 'Resolved', statuses: ['RESOLVED', 'CLOSED'] },
  { key: 'all', label: 'All', statuses: null },
];

export const DEFAULT_TAB = 'all';
export const ANY = 'any';

export interface FilterState {
  tab: string;
  priority: string;
  intent: string;
  assignee: string;
  q: string;
  page: number;
}

/** Inbox filters live in the URL, so a filtered view can be shared and survives reloads. */
export function useTicketFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state: FilterState = useMemo(
    () => ({
      tab: params.get('tab') ?? DEFAULT_TAB,
      priority: params.get('priority') ?? ANY,
      intent: params.get('intent') ?? ANY,
      assignee: params.get('assignee') ?? ANY,
      q: params.get('q') ?? '',
      page: Math.max(1, Number(params.get('page')) || 1),
    }),
    [params],
  );

  const set = useCallback(
    (patch: Partial<FilterState>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(patch)) {
        const isDefault =
          value === '' ||
          value === ANY ||
          (key === 'tab' && value === DEFAULT_TAB) ||
          (key === 'page' && value === 1);
        if (isDefault) next.delete(key);
        else next.set(key, String(value));
      }
      // Any filter change goes back to the first page.
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const apiFilters: TicketFilters = useMemo(() => {
    const statuses = STATUS_TABS.find((t) => t.key === state.tab)?.statuses;
    return {
      status: statuses?.join(','),
      priority: state.priority === ANY ? undefined : state.priority,
      intent: state.intent === ANY ? undefined : state.intent,
      assigneeId: state.assignee === ANY ? undefined : state.assignee,
      q: state.q || undefined,
      page: state.page,
    };
  }, [state]);

  const hasFilters =
    state.priority !== ANY || state.intent !== ANY || state.assignee !== ANY || state.q !== '';

  return { state, set, apiFilters, hasFilters };
}
