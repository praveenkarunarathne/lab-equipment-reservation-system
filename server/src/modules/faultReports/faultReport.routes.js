import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createFaultReportService } from './faultReport.service.js';
import { createFaultReportController } from './faultReport.controller.js';
import {
  faultReportCreateSchema,
  faultReportResolveSchema,
  faultReportParamsSchema,
  faultReportQuerySchema,
  adminFaultReportQuerySchema,
} from './faultReport.validation.js';

export function createFaultReportRouter(connection) {
  const router = Router();
  const controller = createFaultReportController(
    createFaultReportService(connection),
  );
  router.use(requireAuth);
  router.post(
    '/',
    requireRole('student'),
    validate({ body: faultReportCreateSchema }),
    controller.create,
  );
  router.get(
    '/mine',
    requireRole('student'),
    validate({ query: faultReportQuerySchema }),
    controller.list,
  );
  router.get(
    '/',
    requireRole('admin'),
    validate({ query: adminFaultReportQuerySchema }),
    controller.list,
  );
  router.get(
    '/:id',
    validate({ params: faultReportParamsSchema }),
    controller.detail,
  );
  router.patch(
    '/:id/resolve',
    requireRole('admin'),
    validate({
      params: faultReportParamsSchema,
      body: faultReportResolveSchema,
    }),
    controller.resolve,
  );
  return router;
}
