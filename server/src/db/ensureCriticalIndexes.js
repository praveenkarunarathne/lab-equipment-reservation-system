import { getUserModel } from '../modules/users/user.model.js';
import { getEquipmentModel } from '../modules/equipment/equipment.model.js';
import { getReservationModel } from '../modules/reservations/reservation.model.js';

export async function ensureCriticalIndexes(connection) {
  getUserModel(connection);
  getEquipmentModel(connection);
  getReservationModel(connection);
  for (const model of Object.values(connection.models)) {
    await model.createIndexes();
  }
  await connection.db
    .collection('sessions')
    .createIndex({ expires: 1 }, { name: 'expires_1', expireAfterSeconds: 0 });
}
