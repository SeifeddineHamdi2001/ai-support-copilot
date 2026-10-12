import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/**
 * Like @IsOptional(), but only for `undefined`: an explicit `null` is still validated (and rejected by the
 * type validators). Used on PATCH fields that may be omitted but never cleared.
 */
export const IsOptionalNotNull = () => ValidateIf((_obj, value) => value !== undefined);

/** Trims string input; leaves other types for the validators to reject. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** `['a', 'b']` → `['a', '-a', 'b', '-b']` for `sort` query whitelists. */
export const sortOptions = <T extends string>(fields: readonly T[]) =>
  fields.flatMap((f) => [f, `-${f}`]);

export function parseSort<T extends string>(sort: string): { field: T; direction: 'asc' | 'desc' } {
  return sort.startsWith('-')
    ? { field: sort.slice(1) as T, direction: 'desc' }
    : { field: sort as T, direction: 'asc' };
}
