import { getFaultReportModel } from './faultReport.model.js';
import { getEquipmentModel } from '../equipment/equipment.model.js';
import { faultReportDto } from './faultReport.dto.js';
import { AppError } from '../../shared/AppError.js';
import { clock } from '../../shared/clock.js';

export function createFaultReportService(connection) {
  const FaultReport = getFaultReportModel(connection);
  const Equipment = getEquipmentModel(connection);
  function summaries(query, admin) {
    query.populate('equipmentId', 'assetCode name location status archivedAt');
    query.populate('resolvedBy', 'name email');
    if (admin) query.populate('reportedBy', 'name email');
    return query.lean();
  }
  async function detail(id, actor) {
    const admin = actor.role === 'admin';
    const report = await summaries(
      FaultReport.findOne({
        _id: id,
        ...(!admin && { reportedBy: actor.userId }),
      }),
      admin,
    );
    if (!report)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Fault report not found.');
    return faultReportDto(report, admin);
  }
  return {
    detail,
    async create(input, actor) {
      const equipment = await Equipment.exists({
        _id: input.equipmentId,
        archivedAt: null,
      });
      if (!equipment)
        throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Equipment not found.');
      const report = await FaultReport.create({
        ...input,
        reportedBy: actor.userId,
      });
      return detail(report.id, actor);
    },
    async list({ status, equipmentId, reportedBy, page, limit }, actor) {
      const admin = actor.role === 'admin';
      const filter = {};
      if (status) filter.status = status;
      if (admin) {
        if (equipmentId) filter.equipmentId = equipmentId;
        if (reportedBy) filter.reportedBy = reportedBy;
      } else filter.reportedBy = actor.userId;
      const [reports, total] = await Promise.all([
        summaries(
          FaultReport.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
          admin,
        ),
        FaultReport.countDocuments(filter),
      ]);
      return {
        data: reports.map((report) => faultReportDto(report, admin)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    async resolve(id, { resolutionNote }, actor) {
      const report = await FaultReport.findOneAndUpdate(
        { _id: id, status: 'open' },
        {
          $set: {
            status: 'resolved',
            resolutionNote,
            resolvedAt: clock.now(),
            resolvedBy: actor.userId,
          },
        },
        { returnDocument: 'after', runValidators: true },
      );
      if (!report) {
        if (!(await FaultReport.exists({ _id: id })))
          throw new AppError(
            404,
            'RESOURCE_NOT_FOUND',
            'Fault report not found.',
          );
        throw new AppError(
          409,
          'FAULT_ALREADY_RESOLVED',
          'This fault report has already been resolved.',
        );
      }
      return detail(id, actor);
    },
  };
}
