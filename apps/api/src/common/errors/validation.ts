import type { ValidationError } from 'class-validator';
import { ValidationFailedError, type FieldError } from './app-errors';

/** Flattens class-validator's nested error tree into `{ field: 'a.b', message }` pairs. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((err) => {
    const field = parent ? `${parent}.${err.property}` : err.property;
    const own = Object.values(err.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flattenValidationErrors(err.children ?? [], field)];
  });
}

/** `exceptionFactory` for the global ValidationPipe: one 400 Problem Details with per-field errors. */
export function validationExceptionFactory(errors: ValidationError[]): ValidationFailedError {
  return new ValidationFailedError(flattenValidationErrors(errors));
}
