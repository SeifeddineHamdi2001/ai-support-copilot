import { plainToInstance } from 'class-transformer';
import { ListTicketsQueryDto } from './dto/ticket-requests.dto';
import { buildTicketOrderBy, buildTicketWhere } from './ticket-query';

const query = (raw: Record<string, unknown>) => plainToInstance(ListTicketsQueryDto, raw);
const AGENT = '00000000-0000-4000-8000-000000000101';

describe('buildTicketWhere', () => {
  it('returns an empty filter by default', () => {
    expect(buildTicketWhere(query({}))).toEqual({});
  });

  it('accepts repeated and comma-separated enum filters', () => {
    expect(
      buildTicketWhere(query({ status: 'OPEN,IN_PROGRESS', priority: ['HIGH', 'URGENT'] })),
    ).toEqual({
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      priority: { in: ['HIGH', 'URGENT'] },
    });
  });

  it('maps assigneeId=unassigned to a null filter', () => {
    expect(buildTicketWhere(query({ assigneeId: 'unassigned' }))).toEqual({ assigneeId: null });
    expect(buildTicketWhere(query({ assigneeId: AGENT }))).toEqual({ assigneeId: AGENT });
  });

  it('searches subject and body, and the ticket number for numeric input', () => {
    expect(buildTicketWhere(query({ q: 'refund' })).OR).toHaveLength(2);
    expect(buildTicketWhere(query({ q: '#42' })).OR).toContainEqual({ number: 42 });
    expect(buildTicketWhere(query({ q: '42' })).OR).toContainEqual({ number: 42 });
  });
});

describe('buildTicketOrderBy', () => {
  it('sorts descending with a leading dash and adds a stable tie-breaker', () => {
    expect(buildTicketOrderBy('-priority')).toEqual([{ priority: 'desc' }, { number: 'desc' }]);
    expect(buildTicketOrderBy('createdAt')).toEqual([{ createdAt: 'asc' }, { number: 'desc' }]);
  });

  it('puts tickets without an SLA last', () => {
    expect(buildTicketOrderBy('slaDueAt')[0]).toEqual({ slaDueAt: { sort: 'asc', nulls: 'last' } });
  });

  it('does not duplicate the number key', () => {
    expect(buildTicketOrderBy('-number')).toEqual([{ number: 'desc' }]);
  });
});
