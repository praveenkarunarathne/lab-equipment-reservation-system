export async function ensureCriticalIndexes(connection) {
  for (const model of Object.values(connection.models)) {
    await model.createIndexes();
  }
  await connection.db
    .collection('sessions')
    .createIndex({ expires: 1 }, { name: 'expires_1', expireAfterSeconds: 0 });
}
