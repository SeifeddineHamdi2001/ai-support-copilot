'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgent } from '@/lib/agent-context';
import { ApiError } from '@/lib/api';

export function LoginScreen() {
  const { login } = useAgent();
  const [email, setEmail] = useState('alex.morgan@acme-support.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="bg-background flex min-h-dvh items-center justify-center px-5">
      <section className="bg-surface border-border w-full max-w-sm rounded-lg border p-6">
        <LinkMark />
        <h1 className="mt-7 text-lg font-semibold tracking-tight">Sign in to Relay</h1>
        <p className="text-muted-foreground mt-1 text-sm">Use your support workspace account.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">
            Email
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Password
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <Button className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </section>
    </main>
  );
}

function LinkMark() {
  return <span className="text-[15px] font-semibold tracking-tight">Relay</span>;
}
