import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-errors';
import { paginate, Paginated, skipTake } from '../../common/http/pagination';
import { parseSort } from '../../common/http/validators';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  CreateCustomerDto,
  CustomerDto,
  CustomerSortField,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

const withTicketCount = { _count: { select: { tickets: true } } } satisfies Prisma.CustomerInclude;
type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof withTicketCount }>;

const toDto = ({ _count, ...c }: CustomerRow): CustomerDto => ({
  ...c,
  ticketCount: _count.tickets,
});

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListCustomersQueryDto): Promise<Paginated<CustomerDto>> {
    const where: Prisma.CustomerWhereInput = {
      tier: q.tier,
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { email: { contains: q.q, mode: 'insensitive' } },
          { company: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    const { field, direction } = parseSort<CustomerSortField>(q.sort);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: withTicketCount,
        orderBy: [{ [field]: direction }, { id: 'asc' }],
        ...skipTake(q),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginate(rows.map(toDto), total, q);
  }

  async get(id: string): Promise<CustomerDto> {
    const row = await this.prisma.customer.findUnique({ where: { id }, include: withTicketCount });
    if (!row) throw new NotFoundError('Customer', id);
    return toDto(row);
  }

  /** A duplicate email surfaces as Prisma P2002 → 409 UNIQUE_VIOLATION (field: email). */
  async create(dto: CreateCustomerDto): Promise<CustomerDto> {
    return toDto(await this.prisma.customer.create({ data: dto, include: withTicketCount }));
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    await this.get(id);
    return toDto(
      await this.prisma.customer.update({ where: { id }, data: dto, include: withTicketCount }),
    );
  }

  async remove(id: string): Promise<void> {
    const customer = await this.get(id);
    if (customer.ticketCount > 0) {
      throw new ConflictError(
        'CUSTOMER_HAS_TICKETS',
        `Customer has ${customer.ticketCount} ticket(s). Tickets are kept for the audit trail, so the customer cannot be deleted.`,
      );
    }
    // The FK is ON DELETE RESTRICT, so a ticket created concurrently still blocks this (P2003 → 422).
    await this.prisma.customer.delete({ where: { id } });
  }
}
