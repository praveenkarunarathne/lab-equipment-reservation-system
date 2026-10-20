import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../shared/AppError.js';

export function csrfProtection(appOrigin) {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    let originAllowed = true;
    const origin = req.get('Origin');
    const referer = req.get('Referer');
    if (origin !== undefined) {
      originAllowed = origin === appOrigin;
    } else if (referer !== undefined) {
      try {
        originAllowed = new URL(referer).origin === appOrigin;
      } catch {
        originAllowed = false;
      }
    }

    const supplied = req.get('X-CSRF-Token');
    const expected = req.session?.csrfToken;
    if (
      req.get('Sec-Fetch-Site') === 'cross-site' ||
      !originAllowed ||
      !supplied ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !expected ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      return next(
        new AppError(
          403,
          'CSRF_INVALID',
          'Invalid CSRF token or request origin.',
        ),
      );
    }
    next();
  };
}

export async function issueCsrfToken(req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
    await new Promise((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
  }
  res.json({ data: { csrfToken: req.session.csrfToken } });
}
