import { SLOT_DURATION_MS } from '../../config/constants.js';

export function reservationDto(reservation, equipment, serverNow, student) {
  const endAt = new Date(reservation.startAt.getTime() + SLOT_DURATION_MS);
  const phase =
    reservation.startAt > serverNow
      ? 'upcoming'
      : endAt > serverNow
        ? 'inProgress'
        : 'past';
  return {
    id: reservation._id.toString(),
    status: reservation.status,
    startAt: reservation.startAt.toISOString(),
    endAt: endAt.toISOString(),
    phase,
    cancellationReason: reservation.cancellationReason,
    cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
    equipment: {
      id: equipment._id.toString(),
      assetCode: equipment.assetCode,
      name: equipment.name,
      location: equipment.location,
      status: equipment.status,
      archived: Boolean(equipment.archivedAt),
    },
    ...(student && {
      student: {
        id: student._id.toString(),
        name: student.name,
        email: student.email,
      },
    }),
  };
}
