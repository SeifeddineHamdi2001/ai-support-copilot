import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ValidationError } from 'class-validator';
import { InvalidTransitionError, NotFoundError, VersionConflictError } from './app-errors';
import { ProblemDetailsFilter } from './problem-details.filter';
import { flattenValidationErrors } from './validation';

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db says no', { code, clientVersion: '6', meta });

describe('ProblemDetailsFilter.toProblem', () => {
  const filter = new ProblemDetailsFilter();

  it('maps AppErrors with their code, title and field errors', () => {
    const p = filter.toProblem(new InvalidTransitionError('CLOSED', 'OPEN', []));
    expect(p).toMatchObject({
      status: 409,
      errorCode: 'INVALID_STATUS_TRANSITION',
      type: 'https://errors.copilot.local/invalid-status-transition',
      errors: [{ field: 'status' }],
    });
    expect(p.detail).toMatch(/terminal/);
  });

  it('maps version conflicts and not-found errors', () => {
    expect(filter.toProblem(new VersionConflictError('Ticket', 1, 2))).toMatchObject({
      status: 409,
      errorCode: 'TICKET_VERSION_CONFLICT',
    });
    expect(filter.toProblem(new NotFoundError('Ticket', 'x'))).toMatchObject({
      status: 404,
      errorCode: 'TICKET_NOT_FOUND',
    });
  });

  it.each([
    ['P2025', 404, 'NOT_FOUND'],
    ['P2002', 409, 'UNIQUE_VIOLATION'],
    ['P2003', 422, 'INVALID_REFERENCE'],
  ])('maps Prisma %s to %i %s', (code, status, errorCode) => {
    expect(filter.toProblem(prismaError(code, { target: ['email'] }))).toMatchObject({
      status,
      errorCode,
    });
  });

  it('names the unique field for P2002', () => {
    expect(filter.toProblem(prismaError('P2002', { target: ['email'] })).errors).toEqual([
      { field: 'email', message: 'must be unique' },
    ]);
  });

  it('hides unknown errors and unmapped Prisma errors behind a generic 500', () => {
    for (const e of [new Error('SELECT * FROM secrets'), prismaError('P1001')]) {
      const p = filter.toProblem(e);
      expect(p).toMatchObject({ status: 500, errorCode: 'INTERNAL_ERROR' });
      expect(JSON.stringify(p)).not.toMatch(/secrets|db says no/);
    }
  });

  it('maps the body parser oversized-body error to 413', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    expect(filter.toProblem(tooLarge)).toMatchObject({
      status: 413,
      errorCode: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('maps framework HttpExceptions by status', () => {
    expect(filter.toProblem(new NotFoundException('Cannot GET /nope'))).toMatchObject({
      status: 404,
      errorCode: 'NOT_FOUND',
      detail: 'Cannot GET /nope',
    });
    expect(
      filter.toProblem(new BadRequestException('Validation failed (uuid is expected)')),
    ).toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
  });
});

describe('flattenValidationErrors', () => {
  it('flattens nested errors into dotted field paths', () => {
    const child = Object.assign(new ValidationError(), {
      property: 'email',
      constraints: { isEmail: 'email must be an email' },
      children: [],
    });
    const root = Object.assign(new ValidationError(), {
      property: 'customer',
      constraints: {},
      children: [child],
    });
    const top = Object.assign(new ValidationError(), {
      property: 'subject',
      constraints: { maxLength: 'too long', isString: 'not a string' },
      children: [],
    });
    expect(flattenValidationErrors([top, root])).toEqual([
      { field: 'subject', message: 'too long' },
      { field: 'subject', message: 'not a string' },
      { field: 'customer.email', message: 'email must be an email' },
    ]);
  });
});
