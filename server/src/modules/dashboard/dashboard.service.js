import { getEquipmentModel } from '../equipment/equipment.model.js';
import { getReservationModel } from '../reservations/reservation.model.js';
import { getFaultReportModel } from '../faultReports/faultReport.model.js';
import { clock } from '../../shared/clock.js';

export function createDashboardService(connection) {
  const Equipment = getEquipmentModel(connection);
  const Reservation = getReservationModel(connection);
  const FaultReport = getFaultReportModel(connection);
  return {
    async overview() {
      const serverNow = clock.now();
      const since = new Date(serverNow.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [
        statusCounts,
        upcomingReservationCount,
        openFaultReportCount,
        topEquipment,
      ] = await Promise.all([
        Equipment.aggregate([
          { $match: { archivedAt: null } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Reservation.countDocuments({
          status: 'active',
          startAt: { $gt: serverNow },
        }),
        FaultReport.countDocuments({ status: 'open' }),
        Reservation.aggregate([
          {
            $match: {
              status: 'active',
              startAt: { $gte: since, $lt: serverNow },
            },
          },
          { $group: { _id: '$equipmentId', reservationCount: { $sum: 1 } } },
          {
            $lookup: {
              from: Equipment.collection.name,
              localField: '_id',
              foreignField: '_id',
              as: 'equipment',
            },
          },
          { $unwind: '$equipment' },
          { $match: { 'equipment.archivedAt': null } },
          {
            $project: {
              _id: 0,
              equipmentId: { $toString: '$_id' },
              assetCode: '$equipment.assetCode',
              name: '$equipment.name',
              reservationCount: 1,
            },
          },
          { $sort: { reservationCount: -1, name: 1, equipmentId: 1 } },
          { $limit: 5 },
        ]),
      ]);
      const byStatus = { available: 0, maintenance: 0, unavailable: 0 };
      for (const { _id, count } of statusCounts) byStatus[_id] = count;
      return {
        equipment: {
          total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
          byStatus,
        },
        upcomingReservationCount,
        openFaultReportCount,
        topEquipment,
      };
    },
  };
}
