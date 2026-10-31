import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import ErrorMessage from '../components/ErrorMessage.jsx';

function ResolveForm({ id, onResolved, onConflict }) {
  const { request } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function resolve(event) {
    event.preventDefault();
    if (busy) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await request(`/fault-reports/${id}/resolve`, { method: 'PATCH', body });
      onResolved();
    } catch (failure) {
      if (failure.code === 'FAULT_ALREADY_RESOLVED') onConflict(failure);
      else setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const messages = error?.fieldErrors?.['body.resolutionNote'];
  return (
    <section>
      <h2>Resolve report</h2>
      <p>
        Resolving this report does not change equipment availability. Manage
        equipment status separately.
      </p>
      {error && <p role="alert">{error.message}</p>}
      <form className="equipment-form" onSubmit={resolve}>
        <fieldset disabled={busy}>
          <div className="form-field">
            <label htmlFor="resolutionNote">Resolution note</label>
            <textarea
              id="resolutionNote"
              name="resolutionNote"
              required
              minLength={5}
              maxLength={1000}
              rows={5}
              aria-invalid={Boolean(messages)}
              aria-describedby={messages ? 'resolution-error' : undefined}
            />
            {messages && (
              <small className="field-error" id="resolution-error">
                {messages.join(' ')}
              </small>
            )}
          </div>
          <button type="submit">
            {busy ? 'Resolving…' : 'Resolve report'}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
export default function FaultReportDetailPage() {
  const { id } = useParams();
  return <FaultReportDetail key={id} id={id} />;
}
function FaultReportDetail({ id }) {
  const { user } = useAuth();
  const location = useLocation();
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(null);
  const { data, loading, error, retry } = useApiResource(
    `/fault-reports/${encodeURIComponent(id)}`,
  );
  return (
    <section>
      <p>
        <Link
          to={user.role === 'admin' ? '/admin/fault-reports' : '/fault-reports'}
        >
          Back to fault reports
        </Link>
      </p>
      <h1>{data?.title ?? 'Fault report'}</h1>
      {location.state?.created && (
        <p role="status">Fault report submitted for staff review.</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {conflict && <p role="alert">{conflict.message}</p>}
      {loading && <p role="status">Loading fault report…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <>
          <p>Status: {data.status === 'open' ? 'Open' : 'Resolved'}</p>
          <p>Category: {data.category}</p>
          <p>
            {data.equipment ? (
              <>
                {data.equipment.archived ? (
                  `${data.equipment.name} (Archived)`
                ) : (
                  <Link to={`/equipment/${data.equipment.id}`}>
                    {data.equipment.name}
                  </Link>
                )}{' '}
                , {data.equipment.assetCode}, {data.equipment.location}
              </>
            ) : (
              'Equipment no longer available'
            )}
          </p>
          {data.reportedBy && (
            <p>
              Reported by: {data.reportedBy.name} ({data.reportedBy.email})
            </p>
          )}
          <p>
            Reported:{' '}
            <time dateTime={data.createdAt}>
              {new Date(data.createdAt).toLocaleString('en-GB', {
                timeZone: 'Asia/Colombo',
              })}
            </time>{' '}
            (Asia/Colombo)
          </p>
          <h2>Description</h2>
          <p className="equipment-description">{data.description}</p>
          {data.status === 'resolved' && (
            <section>
              <h2>Resolution</h2>
              <p className="equipment-description">{data.resolutionNote}</p>
              <p>Resolved by: {data.resolvedBy?.name ?? 'Administrator'}</p>
              <p>
                <time dateTime={data.resolvedAt}>
                  {new Date(data.resolvedAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Colombo',
                  })}
                </time>{' '}
                (Asia/Colombo)
              </p>
            </section>
          )}
          {user.role === 'admin' && data.status === 'open' && (
            <ResolveForm
              id={data.id}
              onResolved={() => {
                setNotice('Fault report resolved.');
                setConflict(null);
                retry();
              }}
              onConflict={(failure) => {
                setConflict(failure);
                retry();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
