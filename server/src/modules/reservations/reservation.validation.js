import { z } from 'zod';
import { objectIdSchema } from '../../shared/objectId.js';

export const reservationParamsSchema = z.strictObject({ id: objectIdSchema });
export const reservationCancelSchema = z.strictObject({}).optional();
export const reservationQuerySchema = z.strictObject({
  view: z.enum(['upcoming', 'history', 'all']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export const adminReservationQuerySchema = reservationQuerySchema.extend({
  equipmentId: objectIdSchema.optional(),
  studentId: objectIdSchema.optional(),
});

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
