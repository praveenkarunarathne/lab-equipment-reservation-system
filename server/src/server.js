import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';
import mongoose from 'mongoose';
import { ensureCriticalIndexes } from './db/ensureCriticalIndexes.js';
import { createLogger } from './shared/logger.js';

const logger = createLogger();
try {
  const env = loadEnv();
  logger.level = env.logLevel;
  await connectDatabase(env.mongodbUri);
  await ensureCriticalIndexes(mongoose.connection);
  const server = createApp({ env, logger }).listen(env.port, '0.0.0.0', () => {
    logger.info({ port: env.port }, 'Server listening');
  });
  server.on('error', async (err) => {
    logger.error({ err }, 'HTTP server failed to start');
    await disconnectDatabase();
    process.exitCode = 1;
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => {
      await disconnectDatabase();
      clearTimeout(timeout);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  logger.fatal(
    { err },
    'Server startup failed. Check environment settings, MongoDB, and critical indexes.',
  );
  await disconnectDatabase();
  process.exitCode = 1;
}
