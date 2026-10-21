import helmet from 'helmet';
import { AppError } from '../shared/AppError.js';

export function security(env) {
  const production = env.nodeEnv === 'production';
  return helmet({
    contentSecurityPolicy: production
      ? {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    strictTransportSecurity: production,
  });
}

export function requireJson(req, _res, next) {
  const hasBody =
    req.get('Transfer-Encoding') !== undefined ||
    Number(req.get('Content-Length') ?? 0) > 0;
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    (hasBody || req.get('Content-Type') !== undefined) &&
    req.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
      'application/json'
  ) {
    return next(
      new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Use application/json for unsafe requests.',
      ),
    );
  }
  next();
}
