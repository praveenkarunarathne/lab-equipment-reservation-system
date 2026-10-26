import { Router } from 'express';
import { AppError } from '../shared/AppError.js';
import { csrfProtection, issueCsrfToken } from '../middleware/csrf.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { createEquipmentRouter } from '../modules/equipment/equipment.routes.js';
import { createReservationRouter } from '../modules/reservations/reservation.routes.js';
import { createFaultReportRouter } from '../modules/faultReports/faultReport.routes.js';
import { createDashboardRouter } from '../modules/dashboard/dashboard.routes.js';

export function createApiRouter({
  env,
  connection,
  sessionMiddleware,
  routes,
}) {
  const router = Router();
  router.get('/health', async (_req, res) => {
    try {
      if (connection.readyState !== 1)
        throw new Error('Database disconnected.');
      await connection.db.command({ ping: 1 }, { timeoutMS: 2000 });
    } catch {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Service temporarily unavailable.',
      );
    }
    res.json({ data: { status: 'ok', database: 'ok' } });
  });
  router.use(sessionMiddleware, csrfProtection(env.appOrigin));
  router.get('/auth/csrf', issueCsrfToken);
  router.use('/auth', createAuthRouter(connection, env));
  router.use('/equipment', createEquipmentRouter(connection));
  router.use('/reservations', createReservationRouter(connection));
  router.use('/fault-reports', createFaultReportRouter(connection));
  router.use('/admin', createDashboardRouter(connection));
  router.use(routes);
  return router;
}
