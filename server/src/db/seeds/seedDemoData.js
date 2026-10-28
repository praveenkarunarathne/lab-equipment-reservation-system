import { getUserModel } from '../../modules/users/user.model.js';
import { getEquipmentModel } from '../../modules/equipment/equipment.model.js';
import { getReservationModel } from '../../modules/reservations/reservation.model.js';
import { getFaultReportModel } from '../../modules/faultReports/faultReport.model.js';
import { hashPassword } from '../../shared/password.js';
import { withTransaction } from '../../shared/asyncTransaction.js';
import { clock } from '../../shared/clock.js';
import { createDemoData, DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoData.js';

export function assertDemoEnvironment(nodeEnv) {
  if (!['development', 'test'].includes(nodeEnv))
    throw new Error(
      'Sample seeding is only available in development or test mode.',
    );
}

export async function seedDemoData(connection, { nodeEnv }) {
  assertDemoEnvironment(nodeEnv);
  const User = getUserModel(connection);
  const Equipment = getEquipmentModel(connection);
  const Reservation = getReservationModel(connection);
  const FaultReport = getFaultReportModel(connection);
  const data = createDemoData(clock.now());
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  return withTransaction(connection, async (session) => {
    const existing = await User.findById(DEMO_ACCOUNTS[0]._id).session(session);
    // A committed demo admin marks the whole atomic dataset; preserve edits and original dates.
    if (existing) {
      if (
        existing.email !== DEMO_ACCOUNTS[0].email ||
        existing.role !== 'admin'
      )
        throw new Error('The sample administrator ID is already in use.');
      return { created: false };
    }
    await User.insertMany(
      DEMO_ACCOUNTS.map((account) => ({ ...account, passwordHash })),
      { session },
    );
    await Equipment.insertMany(data.equipment, { session });
    await Reservation.insertMany(data.reservations, { session });
    await FaultReport.insertMany(data.faults, { session });
    return {
      created: true,
      users: DEMO_ACCOUNTS.length,
      equipment: data.equipment.length,
      reservations: data.reservations.length,
      faults: data.faults.length,
    };
  });
}
