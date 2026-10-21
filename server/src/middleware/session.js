import session from 'express-session';
import MongoStore from 'connect-mongo';

export function sessionCookieName(env) {
  return env.nodeEnv === 'production' ? '__Host-lab.sid' : 'lab.sid';
}

export function sessionCookieOptions(env) {
  return {
    path: '/',
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
  };
}

export function createSessionMiddleware(env, connection, logger) {
  const store = MongoStore.create({
    client: connection.getClient(),
    dbName: connection.name,
    collectionName: 'sessions',
    ttl: 8 * 60 * 60,
    touchAfter: 3600,
    // The TTL index is explicitly awaited before accepting traffic.
    autoRemove: 'disabled',
  });
  store.on('error', (err) => logger.error({ err }, 'Session store failed'));

  return session({
    store,
    name: sessionCookieName(env),
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      ...sessionCookieOptions(env),
      maxAge: 8 * 60 * 60 * 1000,
    },
  });
}
