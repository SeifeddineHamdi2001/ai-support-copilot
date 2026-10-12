import { CreateTicketFormSchema, TICKET_TRANSITIONS } from './tickets';

describe('CreateTicketFormSchema', () => {
  const valid = {
    customerId: '00000000-0000-4000-8000-000000000201',
    subject: 'Charged twice',
    body: 'My card was charged twice for October.',
    channel: 'EMAIL',
  };

  it('accepts a valid ticket and trims text', () => {
    const parsed = CreateTicketFormSchema.parse({ ...valid, subject: '  Charged twice  ' });
    expect(parsed.subject).toBe('Charged twice');
  });

  it.each([
    ['customerId', '', 'Choose a customer'],
    ['subject', 'ab', 'Subject must be at least 3 characters'],
    ['body', 'too short', 'Message must be at least 10 characters'],
  ])('rejects %s=%j with a readable message', (field, value, message) => {
    const result = CreateTicketFormSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: [field], message });
  });
});

describe('TICKET_TRANSITIONS', () => {
  it('makes CLOSED terminal', () => {
    expect(TICKET_TRANSITIONS.CLOSED).toEqual([]);
  });
});
