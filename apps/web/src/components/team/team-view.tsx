'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { WorkspaceUser } from '@/lib/types';

const ROLES = ['AGENT', 'MANAGER', 'ADMIN'] as const;
const ROLE_LABEL = { AGENT: 'Agent', MANAGER: 'Manager', ADMIN: 'Admin' } as const;
const KEY = ['workspace-users'];

export function TeamView() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: KEY, queryFn: () => api<WorkspaceUser[]>('/users') });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('AGENT');
  const [password, setPassword] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<WorkspaceUser>('/users', { method: 'POST', body: { name, email, role, password } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      setName('');
      setEmail('');
      setPassword('');
      toast.success('Teammate added');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const update = useMutation({
    mutationFn: (body: { id: string; role?: string; isActive?: boolean }) =>
      api<WorkspaceUser>('/users', { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success('Access updated');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Team" count={users.data?.length} />
      <div className="grid gap-8 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <h2 className="mb-3 font-semibold">Workspace users</h2>
          {users.error ? (
            <p className="text-danger text-sm">
              Could not load users: {(users.error as Error).message}
            </p>
          ) : (
            <div className="border-border overflow-x-auto rounded-md border bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-sunken text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.data?.map((user) => (
                    <tr className="border-border border-t" key={user.id}>
                      <td className="px-3 py-2 font-medium">{user.name}</td>
                      <td className="px-3 py-2">{user.email}</td>
                      <td className="px-3 py-2">
                        <select
                          className="bg-surface rounded border px-2 py-1"
                          value={user.role}
                          onChange={(e) => update.mutate({ id: user.id, role: e.target.value })}
                        >
                          {ROLES.map((item) => (
                            <option key={item} value={item}>
                              {ROLE_LABEL[item]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">{user.isActive ? 'Active' : 'Inactive'}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: user.id, isActive: !user.isActive })}
                        >
                          {user.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="border-border h-fit rounded-md border bg-surface p-4">
          <h2 className="font-semibold">Add teammate</h2>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label className="block space-y-1 text-xs font-medium">
              Name
              <Input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-xs font-medium">
              Email
              <Input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-xs font-medium">
              Role
              <select
                className="bg-surface border-input h-8 w-full rounded-md border px-2"
                value={role}
                onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
              >
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium">
              Temporary password
              <Input
                required
                type="password"
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button className="w-full" disabled={create.isPending}>
              Add teammate
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
