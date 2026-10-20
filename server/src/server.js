import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';

try {
  const env = loadEnv();
  await connectDatabase(env.mongodbUri);
  const server = createApp().listen(env.port, '0.0.0.0', () => {
    console.info(`Server listening on port ${env.port}`);
  });
  server.on('error', async () => {
    console.error('HTTP server failed to start.');
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
} catch {
  console.error(
    'Server startup failed. Check environment settings and MongoDB availability.',
  );
  await disconnectDatabase();
  process.exitCode = 1;
}
