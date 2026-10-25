import mongoose from 'mongoose';
import { FAULT_CATEGORIES } from '../../config/constants.js';

const faultReportSchema = new mongoose.Schema(
  {
    equipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipment',
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    category: { type: String, enum: FAULT_CATEGORIES, required: true },
    title: {
      type: String,
      trim: true,
      minlength: 5,
      maxlength: 100,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      minlength: 10,
      maxlength: 2000,
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      required: true,
    },
    resolutionNote: {
      type: String,
      trim: true,
      minlength: 5,
      maxlength: 1000,
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true, autoIndex: false },
);

faultReportSchema.index(
  { status: 1, createdAt: -1 },
  { name: 'idx_fault_status_created' },
);
faultReportSchema.index(
  { reportedBy: 1, createdAt: -1 },
  { name: 'idx_fault_reporter_created' },
);
faultReportSchema.index(
  { equipmentId: 1, createdAt: -1 },
  { name: 'idx_fault_equipment_created' },
);

export function getFaultReportModel(connection) {
  return (
    connection.models.FaultReport ??
    connection.model('FaultReport', faultReportSchema)
  );
}
