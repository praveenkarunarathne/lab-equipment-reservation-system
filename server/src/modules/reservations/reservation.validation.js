import { z } from 'zod';
import { objectIdSchema } from '../../shared/objectId.js';

export const reservationCreateSchema = z.strictObject({
  equipmentId: objectIdSchema,
  startAt: z.iso
    .datetime({ offset: true })
    // Date truncates sub-millisecond fractions; reject them before converting.
    .refine(
      (value) => !/\.\d*[1-9]/.test(value),
      'Use an exact slot start with zero fractional seconds.',
    )
    .transform((value) => new Date(value))
    .refine(
      (date) => Number.isFinite(date.getTime()),
      'Start time must be a valid instant.',
    ),
});
