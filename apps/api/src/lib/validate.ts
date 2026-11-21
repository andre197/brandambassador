import { zodFieldErrors } from '@ba/shared';
import { z } from 'zod';
import { validation } from './errors.js';

/**
 * Parses input with a zod schema or throws a `validation_failed` AppError with i18n field keys.
 * A missing body/query (undefined) is treated as `{}` for object schemas only.
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const input = data === undefined && schema instanceof z.ZodObject ? {} : data;
  const r = schema.safeParse(input);
  if (!r.success) throw validation(zodFieldErrors(r.error));
  return r.data;
}
