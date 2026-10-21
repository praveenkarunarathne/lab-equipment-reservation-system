import { Router } from 'express';
import { createAuthService } from './auth.service.js';
import { createAuthController } from './auth.controller.js';
import { registrationSchema, loginSchema } from './auth.validation.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';

export function createAuthRouter(connection, env) {
  const router = Router();
  const controller = createAuthController(createAuthService(connection), env);
  router.post(
    '/register',
    validate({ body: registrationSchema }),
    controller.register,
  );
  router.post('/login', validate({ body: loginSchema }), controller.login);
  router.post('/logout', requireAuth, controller.logout);
  router.get('/me', requireAuth, controller.me);
  return router;
}
