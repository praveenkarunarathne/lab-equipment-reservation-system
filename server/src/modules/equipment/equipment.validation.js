import { z } from 'zod';
import { EQUIPMENT_STATUSES } from '../../config/constants.js';
import { objectIdSchema } from '../../shared/objectId.js';

export const equipmentCreateSchema = z.strictObject({
  assetCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/),
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(50),
  location: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
});
export const equipmentUpdateSchema = equipmentCreateSchema
  .partial()
  .refine(
    (input) => Object.keys(input).length > 0,
    'Provide at least one metadata field.',
  );
export const equipmentParamsSchema = z.strictObject({ id: objectIdSchema });
export const equipmentQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(50).optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
});
