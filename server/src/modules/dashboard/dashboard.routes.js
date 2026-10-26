import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createDashboardService } from './dashboard.service.js';
import { createDashboardController } from './dashboard.controller.js';

export function createDashboardRouter(connection) {
  const router = Router();
  router.get(
    '/dashboard',
    requireAuth,
    requireRole('admin'),
    createDashboardController(createDashboardService(connection)),
  );
  return router;
}
