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
  function summaries(query, admin) {
    query.populate('equipmentId', 'assetCode name location status archivedAt');
    if (admin) query.populate('studentId', 'name email');
    return query.lean();
  }
  function dto(record, serverNow, admin) {
    return reservationDto(
      record,
      record.equipmentId,
      serverNow,
      admin ? record.studentId : undefined,
    );
  }
  return {
    async list({ view, page, limit, equipmentId, studentId }, actor) {
      const serverNow = clock.now();
      const admin = actor.role === 'admin';
      const filter = {};
      if (!admin) filter.studentId = actor.userId;
      else if (studentId) filter.studentId = studentId;
      if (equipmentId) filter.equipmentId = equipmentId;
      if (view === 'upcoming') {
        filter.status = 'active';
        filter.startAt = { $gt: serverNow };
      } else if (view === 'history') {
        filter.$or = [
          { status: 'cancelled' },
          { startAt: { $lte: serverNow } },
        ];
      }
      const direction = view === 'upcoming' ? 1 : -1;
      const [records, total] = await Promise.all([
        summaries(
          Reservation.find(filter)
            .sort({ startAt: direction, _id: direction })
            .skip((page - 1) * limit)
            .limit(limit),
          admin,
        ),
        Reservation.countDocuments(filter),
      ]);
      return {
        data: records.map((record) => dto(record, serverNow, admin)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    async cancel(id, actor) {
      const admin = actor.role === 'admin';
      const owned = { _id: id, ...(!admin && { studentId: actor.userId }) };
      const serverNow = clock.now();
      // The conditional write preserves the first cancellation's audit under races.
      const updated = await Reservation.findOneAndUpdate(
        { ...owned, status: 'active', startAt: { $gt: serverNow } },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: serverNow,
            cancelledBy: actor.userId,
            cancellationReason: admin ? 'admin_cancelled' : 'student_cancelled',
          },
        },
        { returnDocument: 'after', runValidators: true },
      );
      const record = await summaries(Reservation.findOne(owned), admin);
      if (!record)
        throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Reservation not found.');
      if (!updated && record.status === 'active')
        throw new AppError(
          409,
          'RESERVATION_ALREADY_STARTED',
          'The reservation has already started and cannot be cancelled.',
        );
      return dto(record, serverNow, admin);
    },
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
