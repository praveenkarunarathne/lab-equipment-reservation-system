import { AppError } from '../shared/AppError.js';

export function notFound(_req, _res, next) {
  next(new AppError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.'));
}
