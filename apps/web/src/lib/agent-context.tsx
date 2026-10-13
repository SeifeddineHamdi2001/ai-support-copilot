'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getSessionToken, getSessionUser, setSession } from './api';
import { useAgents } from './queries';
import type { Agent } from './types';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: Agent;
}
interface AgentContextValue {
  agents: Agent[];
  current: Agent | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function readUserSnapshot(): string {
  try {
    const user = getSessionUser();
    const token = getSessionToken();
    const claims = token
      ? (JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
          exp?: number;
        })
      : null;
    return claims?.exp && claims.exp * 1000 > Date.now() ? user : '';
  } catch {
    return '';
  }
}

function subscribeToSession(onChange: () => void) {
  window.addEventListener('relay:session-change', onChange);
  return () => {
    window.removeEventListener('relay:session-change', onChange);
  };
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const storedUser = useSyncExternalStore(subscribeToSession, readUserSnapshot, () => '');
  let current: Agent | null = null;
  try {
    current = storedUser ? (JSON.parse(storedUser) as Agent) : null;
  } catch {
    current = null;
  }
  const queryClient = useQueryClient();
  const { data: agents = [] } = useAgents(current !== null);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      queryClient.clear();
      setSession(result.accessToken, result.user);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    setSession(null, null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AgentContextValue>(
    () => ({
      agents: current ? [current, ...agents.filter((a) => a.id !== current.id)] : [],
      current,
      isLoading: false,
      isAuthenticated: current !== null,
      login,
      logout,
    }),
    [agents, current, login, logout],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>');
  return ctx;
}
