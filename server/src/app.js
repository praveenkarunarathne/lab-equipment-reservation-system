import express from 'express';
import mongoose from 'mongoose';
import pinoHttp from 'pino-http';
import { createLogger, serializeError } from './shared/logger.js';
import { requestId } from './middleware/requestId.js';
import { security, requireJson } from './middleware/security.js';
import { createRateLimits } from './middleware/rateLimits.js';
import { createSessionMiddleware } from './middleware/session.js';
import { createApiRouter } from './routes/apiRouter.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { mountSpa, defaultClientDist } from './middleware/spa.js';

export function createApp({
  env,
  connection = mongoose.connection,
  logger = createLogger(env.logLevel),
  routes = express.Router(),
  clientDist = defaultClientDist,
}) {
  const app = express();
  app.disable('x-powered-by');
  if (env.nodeEnv === 'production') app.set('trust proxy', 1);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      serializers: {
        err: serializeError,
        req: (req) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => ({
        userId: req.session?.userId,
        role: req.session?.role,
      }),
    }),
  );
  app.use(security(env));
  const limits = createRateLimits();
  app.use(
    '/api',
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    limits.general,
  );
  app.use('/api/v1/auth/login', limits.auth);
  app.use('/api/v1/auth/register', limits.auth);
  app.use(
    '/api/v1',
    requireJson,
    express.json({ limit: '16kb' }),
    createApiRouter({
      env,
      connection,
      routes,
      sessionMiddleware: createSessionMiddleware(env, connection, logger),
    }),
  );
  app.use('/api', notFound);
  if (env.nodeEnv === 'production') mountSpa(app, clientDist);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
