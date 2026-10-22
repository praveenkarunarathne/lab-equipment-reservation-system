import mongoose from 'mongoose';
import { EQUIPMENT_STATUSES } from '../../config/constants.js';

const equipmentSchema = new mongoose.Schema(
  {
    assetCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 30,
      match: /^[A-Z0-9][A-Z0-9_-]*$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    location: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    status: {
      type: String,
      enum: EQUIPMENT_STATUSES,
      required: true,
      default: 'available',
    },
    statusReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
      validate: {
        validator(value) {
          return this.get('status') === 'available'
            ? value === null
            : typeof value === 'string' && value.length > 0;
        },
        message:
          'Non-available equipment requires a reason; available equipment has no reason.',
      },
    },
    statusUpdatedAt: { type: Date, required: true, default: Date.now },
    statusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reservationGuardVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    archivedAt: { type: Date, default: null },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true, autoIndex: false },
);

equipmentSchema.index(
  { assetCode: 1 },
  { unique: true, name: 'uq_equipment_asset_code' },
);
equipmentSchema.index(
  { archivedAt: 1, status: 1, category: 1 },
  { name: 'idx_equipment_catalog' },
);

export function getEquipmentModel(connection) {
  return (
    connection.models.Equipment ??
    connection.model('Equipment', equipmentSchema)
  );
}
