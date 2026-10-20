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

  return { nodeEnv, port, mongodbUri };
}
