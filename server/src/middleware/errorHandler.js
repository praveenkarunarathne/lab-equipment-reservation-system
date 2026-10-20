import { AppError } from '../shared/AppError.js';

function publicError(error) {
  if (error instanceof AppError) return error;
  if (error.type === 'entity.parse.failed') {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Request body must be valid JSON.',
    );
  }
  if (error.type === 'entity.too.large') {
    return new AppError(
      413,
      'VALIDATION_ERROR',
      'Request body exceeds the 16 KB limit.',
    );
  }
  if (['charset.unsupported', 'encoding.unsupported'].includes(error.type)) {
    return new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Unsupported body encoding.',
    );
  }
  if (error.code === 11000) {
    if (error.keyPattern?.email) {
      return new AppError(
        409,
        'EMAIL_ALREADY_REGISTERED',
        'Email is already registered.',
      );
    }
    if (error.keyPattern?.assetCode) {
      return new AppError(
        409,
        'ASSET_CODE_ALREADY_EXISTS',
        'Asset code already exists.',
      );
    }
    if (error.keyPattern?.equipmentId && error.keyPattern?.startAt) {
      return new AppError(
        409,
        'RESERVATION_CONFLICT',
        'This equipment slot is already booked.',
      );
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const failure = publicError(error);
  if (failure.status >= 500) {
    req.log.error({ err: error, requestId: req.id }, 'Request failed');
  }
  res.status(failure.status).json({
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.fieldErrors && { fieldErrors: failure.fieldErrors }),
      requestId: req.id,
    },
  });
}
