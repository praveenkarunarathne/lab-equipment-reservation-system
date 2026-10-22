import mongoose from 'mongoose';

const reservationSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    equipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipment',
      required: true,
    },
    startAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['active', 'cancelled'],
      required: true,
      default: 'active',
    },
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancellationReason: {
      type: String,
      enum: [
        'student_cancelled',
        'admin_cancelled',
        'equipment_maintenance',
        'equipment_unavailable',
        'equipment_archived',
        null,
      ],
      default: null,
    },
  },
  { timestamps: true, autoIndex: false },
);

reservationSchema.index(
  { equipmentId: 1, startAt: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'uq_reservation_active_equipment_start',
  },
);
reservationSchema.index(
  { studentId: 1, startAt: -1 },
  { name: 'idx_reservations_student_start' },
);
reservationSchema.index(
  { status: 1, startAt: 1 },
  { name: 'idx_reservations_status_start' },
);

export function getReservationModel(connection) {
  return (
    connection.models.Reservation ??
    connection.model('Reservation', reservationSchema)
  );
}
