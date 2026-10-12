import { HttpStatus } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Base class for expected, client-facing errors. The ProblemDetailsFilter turns any AppError into an
 * RFC 9457 Problem Details response; `errorCode` is the stable, machine-readable part clients switch on.
 */
export abstract class AppError extends Error {
  abstract readonly status: HttpStatus;
  abstract readonly title: string;

  constructor(
    readonly errorCode: string,
    readonly detail: string,
    readonly errors?: FieldError[],
  ) {
    super(detail);
    this.name = new.target.name;
  }
}

/** 400: request is syntactically valid JSON but fails validation. */
export class ValidationFailedError extends AppError {
  readonly status = HttpStatus.BAD_REQUEST;
  readonly title = 'Validation failed';

  constructor(errors: FieldError[], detail = 'One or more fields are invalid.') {
    super('VALIDATION_FAILED', detail, errors);
  }
}

/** 404: the resource addressed by the URL does not exist. */
export class NotFoundError extends AppError {
  readonly status = HttpStatus.NOT_FOUND;
  readonly title = 'Not found';

  constructor(entity: string, id?: string) {
    super(
      `${entity.toUpperCase()}_NOT_FOUND`,
      id ? `${entity} ${id} does not exist.` : `${entity} does not exist.`,
    );
  }
}

/** 409: the request conflicts with the current state (stale version, duplicate, terminal state). */
export class ConflictError extends AppError {
  readonly status = HttpStatus.CONFLICT;
  readonly title: string = 'Conflict';

  constructor(errorCode: string, detail: string, errors?: FieldError[]) {
    super(errorCode, detail, errors);
  }
}

export class VersionConflictError extends ConflictError {
  override readonly title = 'Version conflict';

  constructor(entity: string, expected: number, current?: number) {
    super(
      `${entity.toUpperCase()}_VERSION_CONFLICT`,
      `${entity} was modified by someone else (you sent version ${expected}` +
        (current === undefined ? ')' : `, current is ${current})`) +
        '. Reload and retry.',
    );
  }
}

export class InvalidTransitionError extends ConflictError {
  override readonly title = 'Invalid status transition';

  constructor(
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      'INVALID_STATUS_TRANSITION',
      `Cannot move a ticket from ${from} to ${to}. ` +
        (allowed.length ? `Allowed: ${allowed.join(', ')}.` : `${from} is a terminal status.`),
      [{ field: 'status', message: `${from} → ${to} is not allowed` }],
    );
  }
}

/** 422: well-formed request that references something unusable (unknown customer, inactive agent…). */
export class UnprocessableError extends AppError {
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
  readonly title = 'Unprocessable request';

  constructor(errorCode: string, detail: string, errors?: FieldError[]) {
    super(errorCode, detail, errors);
  }
}
