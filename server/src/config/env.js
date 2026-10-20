export function loadEnv(source = process.env) {
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const port = Number(source.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const mongodbUri = source.MONGODB_URI;
  if (!mongodbUri || !/^mongodb(?:\+srv)?:\/\//.test(mongodbUri)) {
    throw new Error('MONGODB_URI must be a MongoDB connection URI.');
  }

  let origin;
  try {
    origin = new URL(source.APP_ORIGIN);
  } catch {
    throw new Error('APP_ORIGIN must be an exact HTTP(S) origin.');
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== source.APP_ORIGIN ||
    (nodeEnv === 'production' && origin.protocol !== 'https:')
  ) {
    throw new Error(
      'APP_ORIGIN must be an exact origin, using HTTPS in production.',
    );
  }

  const sessionSecret = source.SESSION_SECRET;
  if (!sessionSecret || Buffer.byteLength(sessionSecret.trim()) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 random bytes.');
  }

  const logLevel = source.LOG_LEVEL ?? 'info';
  if (
    !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(
      logLevel,
    )
  ) {
    throw new Error('LOG_LEVEL must be a valid Pino log level.');
  }

  return {
    nodeEnv,
    port,
    mongodbUri,
    appOrigin: origin.origin,
    sessionSecret,
    logLevel,
  };
}
