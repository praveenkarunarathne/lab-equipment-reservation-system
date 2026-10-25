import { z } from 'zod';
import { objectIdSchema } from '../../shared/objectId.js';
import { FAULT_CATEGORIES } from '../../config/constants.js';

export const faultReportParamsSchema = z.strictObject({ id: objectIdSchema });
export const faultReportCreateSchema = z.strictObject({
  equipmentId: objectIdSchema,
  category: z.enum(FAULT_CATEGORIES),
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(10).max(2000),
});
export const faultReportResolveSchema = z.strictObject({
  resolutionNote: z.string().trim().min(5).max(1000),
});
export const faultReportQuerySchema = z.strictObject({
  status: z.enum(['open', 'resolved']).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export const adminFaultReportQuerySchema = faultReportQuerySchema.extend({
  equipmentId: objectIdSchema.optional(),
  reportedBy: objectIdSchema.optional(),
});
