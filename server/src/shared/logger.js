import pino from 'pino';

// Error messages and causes can embed credentials, query values, or URIs.
export function serializeError(error) {
  return {
    type: error.name ?? error.type,
    code: typeof error.code === 'number' ? error.code : undefined,
    stack: error.stack
      ?.split('\n')
      .filter((line) => /^\s+at /.test(line))
      .join('\n'),
  };
}

export function createLogger(level = 'info', destination) {
  return pino(
    {
      level,
      serializers: {
        err: serializeError,
      },
    },
    destination,
  );
}
