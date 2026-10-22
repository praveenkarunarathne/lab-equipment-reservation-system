import { getEquipmentModel } from './equipment.model.js';
import { equipmentDto } from './equipment.dto.js';
import { AppError } from '../../shared/AppError.js';

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
  };
}
