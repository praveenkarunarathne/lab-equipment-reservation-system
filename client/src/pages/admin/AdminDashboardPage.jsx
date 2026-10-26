import { Link } from 'react-router';
import { useApiResource } from '../../api/useApiResource.js';
import ErrorMessage from '../../components/ErrorMessage.jsx';

export default function AdminDashboardPage() {
  const { data, loading, error, retry } = useApiResource('/admin/dashboard');
  return (
    <section>
      <h1>Administration</h1>
      <p>Laboratory overview</p>
      <button type="button" disabled={loading} onClick={retry}>
        Refresh dashboard
      </button>
      {loading && <p role="status">Loading dashboard…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <>
          <dl className="dashboard-metrics">
            {[
              ['Current equipment', data.equipment.total, '/admin/equipment'],
              [
                'Available',
                data.equipment.byStatus.available,
                '/admin/equipment?status=available',
              ],
              [
                'Maintenance',
                data.equipment.byStatus.maintenance,
                '/admin/equipment?status=maintenance',
              ],
              [
                'Unavailable',
                data.equipment.byStatus.unavailable,
                '/admin/equipment?status=unavailable',
              ],
              [
                'Upcoming reservations',
                data.upcomingReservationCount,
                '/admin/reservations?view=upcoming',
              ],
              [
                'Open fault reports',
                data.openFaultReportCount,
                '/admin/fault-reports?status=open',
              ],
            ].map(([label, count, path]) => (
              <div key={label}>
                <dt>
                  <Link to={path}>{label}</Link>
                </dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <h2>Top 5 equipment · previous 30 days</h2>
          <p>
            Counts non-cancelled reservation starts before now, including slots
            in progress. This measures reservations; physical use is not
            tracked. Archived equipment is excluded.
          </p>
          {data.topEquipment.length === 0 ? (
            <p>
              No reservation starts in the previous 30 days for current
              equipment.
            </p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Asset code</th>
                    <th scope="col">Equipment</th>
                    <th scope="col">Reservations</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topEquipment.map((item) => (
                    <tr key={item.equipmentId}>
                      <td>{item.assetCode}</td>
                      <td>
                        <Link to={`/equipment/${item.equipmentId}`}>
                          {item.name}
                        </Link>
                      </td>
                      <td>{item.reservationCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
