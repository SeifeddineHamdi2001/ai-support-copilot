import { Avatar } from '@/components/avatar';
import { useAgent } from '@/lib/agent-context';
import { CHANNEL_LABEL, dateTime, relativeTime, TIER_LABEL } from '@/lib/format';
import type { TicketDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

export function MessageThread({ ticket }: { ticket: TicketDetail }) {
  const { agents } = useAgent();
  const { customer } = ticket;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-5">
      <div>
        <h2
          className="text-lg leading-snug font-semibold text-balance"
          data-testid="ticket-subject"
        >
          {ticket.subject}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {customer.name}
          {customer.company && `, ${customer.company}`}
          {customer.tier !== 'STANDARD' && (
            <span className="text-foreground font-medium"> ({TIER_LABEL[customer.tier]})</span>
          )}{' '}
          via {CHANNEL_LABEL[ticket.channel].toLowerCase()},{' '}
          <time dateTime={ticket.createdAt} title={dateTime(ticket.createdAt)}>
            {relativeTime(ticket.createdAt)}
          </time>
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {ticket.messages.map((m) => {
          const fromCustomer = m.authorType === 'CUSTOMER';
          const author = fromCustomer
            ? customer.name
            : (agents.find((a) => a.id === m.authorId)?.name ?? 'Agent');
          return (
            <li
              key={m.id}
              className={cn(
                'border-border bg-surface rounded-xl border',
                !fromCustomer && 'border-accent-ink/25 bg-accent-wash/50',
              )}
            >
              <div className="border-border flex items-center gap-2 border-b px-4 py-2">
                <Avatar name={author} className="size-5 text-[9.5px]" />
                <span className="font-medium">{author}</span>
                <span className="text-muted-foreground text-xs">
                  {fromCustomer ? customer.email : 'Reply'}
                </span>
                <time
                  dateTime={m.createdAt}
                  className="text-muted-foreground tabular ml-auto font-mono text-xs"
                >
                  {dateTime(m.createdAt)}
                </time>
              </div>
              {/* Plain text only: customer content is never rendered as HTML. */}
              <p className="px-4 py-3 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                {m.body}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
