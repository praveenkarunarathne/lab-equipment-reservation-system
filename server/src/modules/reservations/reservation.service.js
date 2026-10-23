import { getReservationModel } from './reservation.model.js';

export async function cancelFutureReservations(
  connection,
  { equipmentId, actor, serverNow, reason },
  session,
) {
  const Reservation = getReservationModel(connection);
  const result = await Reservation.updateMany(
    { equipmentId, status: 'active', startAt: { $gt: serverNow } },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: serverNow,
        cancelledBy: actor.userId,
        cancellationReason: reason,
      },
    },
    { session },
  );
  return result.modifiedCount;
}
