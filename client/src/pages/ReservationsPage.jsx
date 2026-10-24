import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Pagination from '../components/Pagination.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const phases = {
  upcoming: 'Upcoming',
  inProgress: 'In progress',
  past: 'Past',
};
const reasons = {
  student_cancelled: 'Cancelled by student',
  admin_cancelled: 'Cancelled by administrator',
  equipment_maintenance: 'Equipment under maintenance',
  equipment_unavailable: 'Equipment unavailable',
  equipment_archived: 'Equipment archived',
};

export default function ReservationsPage({ admin = false }) {
  const { user } = useAuth();
  if (!admin && user.role === 'admin')
    return <Navigate to="/admin/reservations" replace />;
  return <ReservationList key={admin ? 'admin' : 'mine'} admin={admin} />;
}

function ReservationList({ admin }) {
  const { request } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams({
    view: params.get('view') ?? 'upcoming',
    page: params.get('page') ?? '1',
    limit: '12',
  });
  if (admin)
    for (const field of ['equipmentId', 'studentId']) {
      if (params.get(field)) query.set(field, params.get(field));
    }
  const { data, loading, error, retry } = useApiResource(
    `/reservations${admin ? '' : '/mine'}?${query}`,
  );
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [notice, setNotice] = useState(null);
  async function cancel() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await request(`/reservations/${selected.id}/cancel`, { method: 'PATCH' });
      setSelected(null);
      setNotice('Reservation cancelled.');
      retry();
    } catch (failure) {
      setFailure(failure);
      if (failure.status === 409) retry();
    } finally {
      setBusy(false);
    }
  }
  function filter(event) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [field, value] of new FormData(event.currentTarget))
      if (value.trim()) next.set(field, value.trim());
    setParams(next);
  }
  return (
    <section>
      <h1>{admin ? 'Manage reservations' : 'My reservations'}</h1>
      <p>
        All times are in Asia/Colombo. Active reservations can be cancelled
        before they start.
      </p>
      <form
        className="catalog-filters"
        key={params.toString()}
        onSubmit={filter}
      >
        <div className="form-field">
          <label htmlFor="reservation-view">View</label>
          <select
            id="reservation-view"
            name="view"
            defaultValue={query.get('view')}
          >
            <option value="upcoming">Upcoming</option>
            <option value="history">History</option>
            <option value="all">All</option>
          </select>
        </div>
        {admin &&
          ['equipmentId', 'studentId'].map(
            (field) =>
              params.get(field) && (
                <input
                  key={field}
                  type="hidden"
                  name={field}
                  value={params.get(field)}
                />
              ),
          )}
        <button type="submit">Apply filters</button>
        <button type="button" disabled={loading || busy} onClick={retry}>
          Refresh reservations
        </button>
        {admin && (params.has('equipmentId') || params.has('studentId')) && (
          <button
            type="button"
            onClick={() => setParams({ view: query.get('view') })}
          >
            Clear filters
          </button>
        )}
      </form>
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading reservations…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <>
          <p role="status">{data.pagination.total} reservations found.</p>
          {data.data.length === 0 ? (
            <p>No reservations match this view.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Equipment</th>
                    {admin && <th scope="col">Student</th>}
                    <th scope="col">Slot (Asia/Colombo)</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((reservation) => (
                    <tr key={reservation.id}>
                      <td>
                        {reservation.equipment.archived ? (
                          <span>{reservation.equipment.name} (Archived)</span>
                        ) : (
                          <Link to={`/equipment/${reservation.equipment.id}`}>
                            {reservation.equipment.name}
                          </Link>
                        )}
                        <br />
                        {reservation.equipment.assetCode} ·{' '}
                        {reservation.equipment.location}
                        {admin && (
                          <>
                            <br />
                            <button
                              onClick={() => {
                                const next = new URLSearchParams(params);
                                next.set(
                                  'equipmentId',
                                  reservation.equipment.id,
                                );
                                next.delete('page');
                                setParams(next);
                              }}
                            >
                              Only this equipment
                            </button>
                          </>
                        )}
                      </td>
                      {admin && (
                        <td>
                          {reservation.student.name}
                          <br />
                          {reservation.student.email}
                          <br />
                          <button
                            onClick={() => {
                              const next = new URLSearchParams(params);
                              next.set('studentId', reservation.student.id);
                              next.delete('page');
                              setParams(next);
                            }}
                          >
                            Only this student
                          </button>
                        </td>
                      )}
                      <td>
                        <time dateTime={reservation.startAt}>
                          {timeFormat.format(new Date(reservation.startAt))}
                        </time>
                        <br />
                        to{' '}
                        <time dateTime={reservation.endAt}>
                          {timeFormat.format(new Date(reservation.endAt))}
                        </time>
                      </td>
                      <td>
                        {reservation.status === 'cancelled' ? (
                          <>
                            {reasons[reservation.cancellationReason] ??
                              'Cancelled'}
                            {reservation.cancelledAt && (
                              <>
                                <br />
                                <time dateTime={reservation.cancelledAt}>
                                  {timeFormat.format(
                                    new Date(reservation.cancelledAt),
                                  )}
                                </time>
                              </>
                            )}
                          </>
                        ) : (
                          phases[reservation.phase]
                        )}
                      </td>
                      <td>
                        {reservation.status === 'active' &&
                          reservation.phase === 'upcoming' && (
                            <button
                              onClick={() => {
                                setSelected(reservation);
                                setFailure(null);
                              }}
                              aria-label={`Cancel reservation for ${reservation.equipment.name}`}
                            >
                              Cancel reservation
                            </button>
                          )}
                      </td>
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
      {selected && (
        <ConfirmDialog
          title="Cancel reservation?"
          busy={busy}
          error={failure}
          onConfirm={cancel}
          onCancel={() => setSelected(null)}
          confirmLabel="Confirm cancellation"
        >
          <p>
            Cancel {selected.equipment.name} on{' '}
            {timeFormat.format(new Date(selected.startAt))} (Asia/Colombo)? This
            frees the slot for another booking.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
