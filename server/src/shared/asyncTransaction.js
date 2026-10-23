export function withTransaction(connection, callback) {
  return connection.transaction(callback, {
    readPreference: 'primary',
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
}
