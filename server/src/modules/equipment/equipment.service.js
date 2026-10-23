import { getEquipmentModel } from './equipment.model.js';
import { equipmentDto } from './equipment.dto.js';
import { AppError } from '../../shared/AppError.js';
import { withTransaction } from '../../shared/asyncTransaction.js';
import { clock } from '../../shared/clock.js';
import {
  cancelFutureReservations,
  equipmentAvailability,
} from '../reservations/reservation.service.js';

function requireAdministrator(actor) {
  if (actor?.role !== 'admin')
    throw new AppError(
      403,
      'FORBIDDEN',
      'Only administrators can change equipment status or archive equipment.',
    );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function requireEquipment(equipment) {
  if (!equipment)
    throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Equipment not found.');
  return equipmentDto(equipment);
}

export function createEquipmentService(connection) {
  const Equipment = getEquipmentModel(connection);
  return {
    async list({ page, limit, q, category, status }) {
      const filter = { archivedAt: null };
      if (q) {
        const expression = new RegExp(escapeRegex(q), 'i');
        filter.$or = ['name', 'assetCode', 'category', 'location'].map(
          (field) => ({ [field]: expression }),
        );
      }
      if (category)
        filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
      if (status) filter.status = status;
      const [equipment, total] = await Promise.all([
        Equipment.find(filter)
          .sort({ name: 1, assetCode: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Equipment.countDocuments(filter),
      ]);
      return {
        data: equipment.map(equipmentDto),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    async detail(id) {
      return requireEquipment(
        await Equipment.findOne({ _id: id, archivedAt: null }).lean(),
      );
    },
    async availability(id) {
      const equipment = requireEquipment(
        await Equipment.findOne({ _id: id, archivedAt: null }).lean(),
      );
      return equipmentAvailability(connection, equipment);
    },
    async create(input, actor) {
      return equipmentDto(
        await Equipment.create({ ...input, statusUpdatedBy: actor.userId }),
      );
    },
    async update(id, input) {
      return requireEquipment(
        await Equipment.findOneAndUpdate(
          { _id: id, archivedAt: null },
          { $set: input },
          { returnDocument: 'after', runValidators: true },
        ).lean(),
      );
    },
    async changeStatus(id, input, actor) {
      requireAdministrator(actor);
      return withTransaction(connection, async (session) => {
        const equipment = await Equipment.findOne({
          _id: id,
          archivedAt: null,
        }).session(session);
        if (!equipment)
          throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Equipment not found.');
        const reason = input.status === 'available' ? null : input.reason;
        if (
          equipment.status === input.status &&
          equipment.statusReason === reason
        ) {
          return {
            equipment: equipmentDto(equipment),
            cancelledReservationCount: 0,
          };
        }
        const serverNow = clock.now();
        equipment.status = input.status;
        equipment.statusReason = reason;
        equipment.statusUpdatedAt = serverNow;
        equipment.statusUpdatedBy = actor.userId;
        // Every lifecycle write shares this guard with the booking transaction.
        equipment.reservationGuardVersion += 1;
        await equipment.save({ session });
        const cancelledReservationCount =
          input.status === 'available'
            ? 0
            : await cancelFutureReservations(
                connection,
                {
                  equipmentId: id,
                  actor,
                  serverNow,
                  reason: `equipment_${input.status}`,
                },
                session,
              );
        return {
          equipment: equipmentDto(equipment),
          cancelledReservationCount,
        };
      });
    },
    async archive(id, actor) {
      requireAdministrator(actor);
      return withTransaction(connection, async (session) => {
        const equipment = await Equipment.findById(id).session(session);
        if (!equipment)
          throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Equipment not found.');
        if (equipment.archivedAt) return;
        const serverNow = clock.now();
        equipment.archivedAt = serverNow;
        equipment.archivedBy = actor.userId;
        equipment.status = 'unavailable';
        equipment.statusReason = 'Equipment archived.';
        equipment.statusUpdatedAt = serverNow;
        equipment.statusUpdatedBy = actor.userId;
        equipment.reservationGuardVersion += 1;
        await equipment.save({ session });
        await cancelFutureReservations(
          connection,
          { equipmentId: id, actor, serverNow, reason: 'equipment_archived' },
          session,
        );
      });
    },
  };
}
