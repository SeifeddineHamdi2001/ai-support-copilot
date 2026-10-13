'use client';

import { TICKET_INTENTS, TICKET_PRIORITIES } from '@copilot/shared';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgent } from '@/lib/agent-context';
import { INTENT_LABEL, PRIORITY_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ANY, STATUS_TABS, type FilterState } from './use-ticket-filters';

interface Props {
  state: FilterState;
  set: (patch: Partial<FilterState>) => void;
}

export function TicketFiltersBar({ state, set }: Props) {
  const { agents, current } = useAgent();

  return (
    <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2">
      <div role="tablist" aria-label="Status" className="-mb-2 flex items-center gap-0.5 self-end">
        {STATUS_TABS.map((tab) => {
          const active = state.tab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              onClick={() => set({ tab: tab.key })}
              className={cn(
                'text-muted-foreground hover:text-foreground relative h-8 rounded-sm px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active &&
                  'text-foreground font-medium after:bg-accent-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Priority"
          value={state.priority}
          onChange={(v) => set({ priority: v })}
          options={TICKET_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        />
        <FilterSelect
          label="Intent"
          value={state.intent}
          onChange={(v) => set({ intent: v })}
          options={TICKET_INTENTS.map((i) => ({ value: i, label: INTENT_LABEL[i] }))}
        />
        {current?.role !== 'AGENT' && (
          <FilterSelect
            label="Assignee"
            value={state.assignee}
            onChange={(v) => set({ assignee: v })}
            extra={[
              ...(current ? [{ value: current.id, label: 'Assigned to me' }] : []),
              { value: 'unassigned', label: 'Unassigned' },
            ]}
            options={agents
              .filter((a) => a.id !== current?.id)
              .map((a) => ({ value: a.id, label: a.name }))}
          />
        )}
        <SearchBox value={state.q} onChange={(q) => set({ q })} />
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  extra = [],
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  extra?: { value: string; label: string }[];
}) {
  const active = value !== ANY;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn('bg-surface min-w-[112px]', active && 'border-accent-ink/50 bg-accent-wash')}
      >
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={ANY}>Any</SelectItem>
        {extra.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
        {extra.length > 0 && <SelectSeparator />}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Debounced search; `/` focuses it from anywhere on the page, Esc clears it. */
function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const [lastValue, setLastValue] = useState(value);

  // Follow URL changes made elsewhere (back button, "Clear filters").
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== draft.trim()) setDraft(value);
  }

  useEffect(() => {
    if (draft.trim() === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative">
      <Search className="text-subtle-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
      <input
        ref={ref}
        type="search"
        aria-label="Search tickets"
        placeholder="Search or #number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft('');
            ref.current?.blur();
          }
        }}
        className="border-input bg-surface placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-ring/30 h-7 w-[240px] rounded-md border pr-7 pl-7 text-sm outline-none focus-visible:ring-2 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setDraft('')}
          className="text-subtle-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="border-border text-subtle-foreground pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm border px-1 font-mono text-[10px]">
          /
        </kbd>
      )}
    </div>
  );
}
