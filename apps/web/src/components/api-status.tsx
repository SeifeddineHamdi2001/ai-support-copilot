'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; db: string; llm: string; embedding: string }
  | { kind: 'error'; message: string };

export function ApiStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`);
        setState({
          kind: 'ok',
          db: body.db,
          llm: body.providers.llm,
          embedding: body.providers.embedding,
        });
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ kind: 'error', message: err.message });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="rounded-md border p-3 font-mono text-xs" data-testid="api-status">
      {state.kind === 'loading' && 'Checking API…'}
      {state.kind === 'ok' &&
        `API ok · database ${state.db} · llm ${state.llm} · embeddings ${state.embedding}`}
      {state.kind === 'error' && `API unreachable at ${API_URL}: ${state.message}`}
    </div>
  );
}
