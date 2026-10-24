import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  reservationCreateSchema,
  reservationQuerySchema,
  adminReservationQuerySchema,
  reservationParamsSchema,
  reservationCancelSchema,
} from './reservation.validation.js';
import { createReservationService } from './reservation.service.js';
import { createReservationController } from './reservation.controller.js';

export function createReservationRouter(connection) {
  const router = Router();
  const controller = createReservationController(
    createReservationService(connection),
  );
  router.use(requireAuth);
  router.get(
    '/mine',
    requireRole('student'),
    validate({ query: reservationQuerySchema }),
    controller.list,
  );
  router.get(
    '/',
    requireRole('admin'),
    validate({ query: adminReservationQuerySchema }),
    controller.list,
  );
  router.patch(
    '/:id/cancel',
    validate({
      params: reservationParamsSchema,
      body: reservationCancelSchema,
    }),
    controller.cancel,
  );
  router.post(
    '/',
    requireRole('student'),
    validate({ body: reservationCreateSchema }),
    controller.create,
  );
  return router;
}
