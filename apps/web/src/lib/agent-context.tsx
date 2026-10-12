'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { useAgents } from './queries';
import type { Agent } from './types';

const STORAGE_KEY = 'relay.agentId';
const listeners = new Set<() => void>();
/** In-memory copy, so switching still works when localStorage is unavailable (private mode). */
let memoryId: string | null = null;

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryId;
  } catch {
    return memoryId;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

interface AgentContextValue {
  agents: Agent[];
  /** The agent the console acts as (sent as X-User-Id). No auth in scope: any seeded agent can be picked. */
  current: Agent | null;
  setCurrent: (id: string) => void;
  isLoading: boolean;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { data: agents = [], isLoading } = useAgents();
  const storedId = useSyncExternalStore(subscribe, readStoredId, () => null);

  const setCurrent = useCallback((id: string) => {
    memoryId = id;
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage unavailable: the in-memory copy lasts until reload.
    }
    listeners.forEach((l) => l());
  }, []);

  const value = useMemo<AgentContextValue>(() => {
    const current = agents.find((a) => a.id === storedId) ?? agents[0] ?? null;
    return { agents, current, setCurrent, isLoading };
  }, [agents, storedId, setCurrent, isLoading]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>');
  return ctx;
}
