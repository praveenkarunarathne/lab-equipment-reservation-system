import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Pagination from '../components/Pagination.jsx';

export default function FaultReportsPage({ admin = false }) {
  const { user } = useAuth();
  if (!admin && user.role === 'admin')
    return <Navigate to="/admin/fault-reports" replace />;
  return <FaultReportList admin={admin} />;
}
function FaultReportList({ admin }) {
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams({
    page: params.get('page') ?? '1',
    limit: '12',
  });
  for (const field of admin
    ? ['status', 'equipmentId', 'reportedBy']
    : ['status'])
    if (params.get(field)) query.set(field, params.get(field));
  const { data, loading, error, retry } = useApiResource(
    `/fault-reports${admin ? '' : '/mine'}?${query}`,
  );
  function narrow(field, value) {
    const next = new URLSearchParams(params);
    next.set(field, value);
    next.delete('page');
    setParams(next);
  }
  return (
    <section>
      <h1>{admin ? 'Manage fault reports' : 'My fault reports'}</h1>
      {!admin && (
        <p>
          <Link to="/fault-reports/new">Report a fault</Link>
        </p>
      )}
      <form
        className="catalog-filters"
        key={params.toString()}
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(params);
          next.delete('page');
          const status = new FormData(event.currentTarget).get('status');
          if (status) next.set('status', status);
          else next.delete('status');
          setParams(next);
        }}
      >
        <div className="form-field">
          <label htmlFor="fault-status">Status</label>
          <select
            id="fault-status"
            name="status"
            defaultValue={params.get('status') ?? ''}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <button type="submit">Apply filters</button>
        <button type="button" disabled={loading} onClick={retry}>
          Refresh reports
        </button>
        {admin && (params.has('equipmentId') || params.has('reportedBy')) && (
          <button
            type="button"
            onClick={() =>
              setParams(
                params.has('status') ? { status: params.get('status') } : {},
              )
            }
          >
            Clear filters
          </button>
        )}
      </form>
      {loading && <p role="status">Loading fault reports…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <>
          <p role="status">{data.pagination.total} fault reports found.</p>
          {data.data.length === 0 ? (
            <p>No fault reports match these filters.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Report</th>
                    <th scope="col">Equipment</th>
                    {admin && <th scope="col">Reported by</th>}
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <Link to={`/fault-reports/${report.id}`}>
                          {report.title}
                        </Link>
                        <br />
                        {report.category}
                        <br />
                        <time dateTime={report.createdAt}>
                          {new Date(report.createdAt).toLocaleString('en-GB', {
                            timeZone: 'Asia/Colombo',
                          })}{' '}
                          (Asia/Colombo)
                        </time>
                      </td>
                      <td>
                        {report.equipment ? (
                          <>
                            {report.equipment.name} ·{' '}
                            {report.equipment.assetCode}
                            {report.equipment.archived && ' (Archived)'}
                            {admin && (
                              <p>
                                <button
                                  onClick={() =>
                                    narrow('equipmentId', report.equipment.id)
                                  }
                                >
                                  Only this equipment
                                </button>
                              </p>
                            )}
                          </>
                        ) : (
                          'Equipment no longer available'
                        )}
                      </td>
                      {admin && (
                        <td>
                          {report.reportedBy ? (
                            <>
                              <span>{report.reportedBy.name}</span>
                              <br />
                              <span>{report.reportedBy.email}</span>
                              <p>
                                <button
                                  onClick={() =>
                                    narrow('reportedBy', report.reportedBy.id)
                                  }
                                >
                                  Only this reporter
                                </button>
                              </p>
                            </>
                          ) : (
                            'Reporter no longer available'
                          )}
                        </td>
                      )}
                      <td>{report.status === 'open' ? 'Open' : 'Resolved'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            pagination={data.pagination}
            onPageChange={(page) => {
              const next = new URLSearchParams(params);
              next.set('page', String(page));
              setParams(next);
            }}
          />
        </>
      )}
    </section>
  );
}
