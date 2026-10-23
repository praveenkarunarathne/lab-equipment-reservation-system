import { getReservationModel } from './reservation.model.js';
import { getEquipmentModel } from '../equipment/equipment.model.js';
import { clock } from '../../shared/clock.js';
import { withTransaction } from '../../shared/asyncTransaction.js';
import { AppError } from '../../shared/AppError.js';
import {
  BUSINESS_TIMEZONE,
  SLOT_DURATION_MINUTES,
  BOOKING_HORIZON_DAYS,
} from '../../config/constants.js';
import {
  assertLegalStart,
  bookingHorizon,
  legalSlotStarts,
  slotDto,
} from './reservationTime.js';
import { reservationDto } from './reservation.dto.js';

export async function equipmentAvailability(connection, equipment) {
  const serverNow = clock.now();
  const bookable = equipment.status === 'available';
  const response = {
    equipmentId: equipment.id,
    bookable,
    timezone: BUSINESS_TIMEZONE,
    slotDurationMinutes: SLOT_DURATION_MINUTES,
    horizonDays: BOOKING_HORIZON_DAYS,
    slots: [],
  };
  if (!bookable) return response;
  const booked = await getReservationModel(connection)
    .find({
      equipmentId: equipment.id,
      status: 'active',
      startAt: { $gt: serverNow, $lte: bookingHorizon(serverNow) },
    })
    .select('startAt -_id')
    .lean();
  const occupied = new Set(
    booked.map((reservation) => reservation.startAt.getTime()),
  );
  response.slots = legalSlotStarts(serverNow)
    .filter((startAt) => !occupied.has(startAt.getTime()))
    .map(slotDto);
  return response;
}

export function createReservationService(connection) {
  const Equipment = getEquipmentModel(connection);
  const Reservation = getReservationModel(connection);
  return {
    async create({ equipmentId, startAt }, actor) {
      if (actor?.role !== 'student')
        throw new AppError(
          403,
          'FORBIDDEN',
          'Only students can create reservations.',
        );
      return withTransaction(connection, async (session) => {
        const equipment = await Equipment.findOneAndUpdate(
          { _id: equipmentId, archivedAt: null, status: 'available' },
          { $inc: { reservationGuardVersion: 1 } },
          { session, returnDocument: 'after', runValidators: true },
        );
        if (!equipment)
          throw new AppError(
            409,
            'EQUIPMENT_NOT_AVAILABLE',
            'Equipment is not available for booking.',
          );
        // Revalidate after the guard write, including on transaction retries or lock waits.
        const serverNow = clock.now();
        assertLegalStart(startAt, serverNow);
        const [reservation] = await Reservation.create(
          [{ equipmentId, studentId: actor.userId, startAt }],
          { session },
        );
        return reservationDto(reservation, equipment, serverNow);
      });
    },
  };
}

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
