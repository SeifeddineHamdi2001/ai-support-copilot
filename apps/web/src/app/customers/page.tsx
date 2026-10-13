'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearchCustomers, useUpdateCustomer, useTickets } from '@/lib/queries';
import type { Customer } from '@/lib/types';

const tiers = ['STANDARD', 'PREMIUM', 'VIP'] as const;

export default function CustomersPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const customers = useSearchCustomers(query);
  const update = useUpdateCustomer(selected?.id ?? '');
  const history = useTickets({ customerId: selected?.id, sort: '-createdAt' });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Customers" count={customers.data?.meta.total} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="min-w-0 flex-1 p-5">
          <label className="mb-3 block max-w-sm text-sm">
            Search customers
            <Input
              className="mt-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, email or company"
            />
          </label>
          {customers.isPending ? (
            <p className="text-muted-foreground py-6">Loading customers…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Customer</th>
                    <th className="p-3 font-medium">Tier</th>
                    <th className="p-3 text-right font-medium">Tickets</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.data?.items.map((customer) => (
                    <tr key={customer.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-3">
                        <button className="text-left" onClick={() => setSelected(customer)}>
                          <span className="block font-medium">{customer.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {customer.email}
                            {customer.company ? ` · ${customer.company}` : ''}
                          </span>
                        </button>
                      </td>
                      <td className="p-3">
                        <span className="rounded border border-border px-2 py-0.5 text-xs">
                          {customer.tier}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums">{customer.ticketCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {customers.data?.items.length === 0 && (
                <p className="text-muted-foreground p-5 text-sm">No customers match this search.</p>
              )}
            </div>
          )}
        </section>
        {selected && (
          <aside className="border-border w-full shrink-0 border-t p-5 lg:w-[360px] lg:border-t-0 lg:border-l">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Customer details</h2>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            <form
              key={selected.id}
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                update.mutate(
                  {
                    name: String(data.get('name')),
                    email: String(data.get('email')),
                    company: String(data.get('company')) || null,
                    tier: String(data.get('tier')) as Customer['tier'],
                  },
                  { onSuccess: setSelected },
                );
              }}
            >
              <label className="text-sm">
                Name
                <Input className="mt-1" name="name" defaultValue={selected.name} required />
              </label>
              <label className="text-sm">
                Email
                <Input
                  className="mt-1"
                  name="email"
                  type="email"
                  defaultValue={selected.email}
                  required
                />
              </label>
              <label className="text-sm">
                Company
                <Input className="mt-1" name="company" defaultValue={selected.company ?? ''} />
              </label>
              <label className="text-sm">
                Tier
                <select
                  name="tier"
                  defaultValue={selected.tier}
                  className="border-input bg-background mt-1 h-8 w-full rounded-lg border px-2 text-sm"
                >
                  {tiers.map((tier) => (
                    <option key={tier}>{tier}</option>
                  ))}
                </select>
              </label>
              <Button size="sm" disabled={update.isPending}>
                Save changes
              </Button>
            </form>
            <h3 className="mt-7 mb-2 text-sm font-semibold">
              Ticket history{' '}
              <span className="text-muted-foreground font-normal">({selected.ticketCount})</span>
            </h3>
            <ul className="divide-border divide-y">
              {history.data?.items.map((ticket) => (
                <li key={ticket.id} className="py-2">
                  <Link className="text-sm hover:underline" href={`/tickets/${ticket.id}`}>
                    #{ticket.number} · {ticket.subject}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {ticket.status.replaceAll('_', ' ')}
                  </p>
                </li>
              ))}
            </ul>
            {history.data?.items.length === 0 && (
              <p className="text-muted-foreground text-sm">No tickets yet.</p>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
