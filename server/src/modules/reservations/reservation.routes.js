import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { reservationCreateSchema } from './reservation.validation.js';
import { createReservationService } from './reservation.service.js';
import { createReservationController } from './reservation.controller.js';

export function createReservationRouter(connection) {
  const router = Router();
  const controller = createReservationController(
    createReservationService(connection),
  );
  router.post(
    '/',
    requireAuth,
    requireRole('student'),
    validate({ body: reservationCreateSchema }),
    controller.create,
  );
  return router;
}
