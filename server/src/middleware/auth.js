import { AppError } from '../shared/AppError.js';

export function requireAuth(req, _res, next) {
  const { userId, role } = req.session ?? {};
  if (
    !/^[a-fA-F0-9]{24}$/.test(userId ?? '') ||
    !['student', 'admin'].includes(role)
  ) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in.'));
  }
  req.actor = { userId, role };
  next();
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.actor)
      return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in.'));
    if (req.actor.role !== role)
      return next(
        new AppError(
          403,
          'FORBIDDEN',
          'You do not have access to this resource.',
        ),
      );
    next();
  };
}
