import { AppError } from '../shared/AppError.js';

export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const fieldErrors = {};
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part]);
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const key = [part, ...issue.path].join('.');
          (fieldErrors[key] ??= []).push(issue.message);
        }
      }
    }
    if (Object.keys(fieldErrors).length) {
      return next(
        new AppError(
          400,
          'VALIDATION_ERROR',
          'Request validation failed.',
          fieldErrors,
        ),
      );
    }
    req.validated = validated;
    next();
  };
}
