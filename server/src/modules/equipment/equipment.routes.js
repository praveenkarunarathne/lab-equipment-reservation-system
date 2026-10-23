import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createEquipmentService } from './equipment.service.js';
import { createEquipmentController } from './equipment.controller.js';
import {
  equipmentCreateSchema,
  equipmentUpdateSchema,
  equipmentParamsSchema,
  equipmentQuerySchema,
  equipmentStatusSchema,
} from './equipment.validation.js';

export function createEquipmentRouter(connection) {
  const router = Router();
  const controller = createEquipmentController(
    createEquipmentService(connection),
  );
  router.use(requireAuth);
  router.get('/', validate({ query: equipmentQuerySchema }), controller.list);
  router.get(
    '/:id',
    validate({ params: equipmentParamsSchema }),
    controller.detail,
  );
  router.post(
    '/',
    requireRole('admin'),
    validate({ body: equipmentCreateSchema }),
    controller.create,
  );
  router.patch(
    '/:id/status',
    requireRole('admin'),
    validate({ params: equipmentParamsSchema, body: equipmentStatusSchema }),
    controller.changeStatus,
  );
  router.delete(
    '/:id',
    requireRole('admin'),
    validate({ params: equipmentParamsSchema }),
    controller.archive,
  );
  router.patch(
    '/:id',
    requireRole('admin'),
    validate({ params: equipmentParamsSchema, body: equipmentUpdateSchema }),
    controller.update,
  );
  return router;
}
