import { rateLimit } from 'express-rate-limit';
import { AppError } from '../shared/AppError.js';

function limiter(windowMs, limit) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many requests. Try again later.',
        ),
      );
    },
  });
}

export function createRateLimits() {
  return {
    general: limiter(60_000, 120),
    auth: limiter(15 * 60_000, 10),
  };
}
