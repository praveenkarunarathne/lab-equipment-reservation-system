import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import ErrorMessage from '../components/ErrorMessage.jsx';

function FaultReportForm({ equipment }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const body = {
      ...Object.fromEntries(new FormData(event.currentTarget)),
      equipmentId: equipment.id,
    };
    setBusy(true);
    setError(null);
    try {
      const report = await request('/fault-reports', { method: 'POST', body });
      navigate(`/fault-reports/${report.id}`, { state: { created: true } });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>Report a fault</h1>
      <p>
        {equipment.name} · {equipment.assetCode} · {equipment.location}
      </p>
      <p role="note">
        Do not use equipment you suspect is unsafe. Inform laboratory staff
        immediately. This web report does not replace physical safety
        procedures.
      </p>
      <p>
        Submitting a report does not change equipment availability. Laboratory
        staff review reports and manage equipment status separately.
      </p>
      {error && <p role="alert">{error.message}</p>}
      <form className="equipment-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          {[
            { name: 'category', label: 'Category' },
            { name: 'title', label: 'Title', min: 5, max: 100 },
            { name: 'description', label: 'Description', min: 10, max: 2000 },
          ].map((field) => {
            const messages = error?.fieldErrors?.[`body.${field.name}`];
            const input = {
              id: field.name,
              name: field.name,
              required: true,
              minLength: field.min,
              maxLength: field.max,
              'aria-invalid': Boolean(messages),
              'aria-describedby': messages ? `${field.name}-error` : undefined,
            };
            return (
              <div className="form-field" key={field.name}>
                <label htmlFor={field.name}>{field.label}</label>
                {field.name === 'category' ? (
                  <select {...input} defaultValue="">
                    <option value="">Choose a category</option>
                    {[
                      'malfunction',
                      'damage',
                      'calibration',
                      'safety',
                      'other',
                    ].map((category) => (
                      <option key={category} value={category}>
                        {category[0].toUpperCase() + category.slice(1)}
                      </option>
                    ))}
                  </select>
                ) : field.name === 'description' ? (
                  <textarea {...input} rows={6} />
                ) : (
                  <input {...input} />
                )}
                {messages && (
                  <small className="field-error" id={`${field.name}-error`}>
                    {messages.join(' ')}
                  </small>
                )}
              </div>
            );
          })}
          <button type="submit">
            {busy ? 'Submitting…' : 'Submit report'}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
function EquipmentReport({ id }) {
  const { data, loading, error, retry } = useApiResource(
    `/equipment/${encodeURIComponent(id)}`,
  );
  if (loading) return <p role="status">Loading equipment…</p>;
  if (error) return <ErrorMessage error={error} onRetry={retry} />;
  return <FaultReportForm equipment={data} />;
}
export default function FaultReportNewPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user.role !== 'student')
    return (
      <section>
        <h1>Access denied</h1>
        <p>Only students can submit fault reports.</p>
      </section>
    );
  const id = params.get('equipmentId');
  return (
    <>
      <p>
        <Link to="/fault-reports">My fault reports</Link>
      </p>
      {id ? (
        <EquipmentReport key={id} id={id} />
      ) : (
        <section>
          <h1>Report a fault</h1>
          <p>
            Choose equipment from the catalog, then select “Report a fault” on
            its detail page.
          </p>
          <Link to="/equipment?status=all">Choose equipment</Link>
        </section>
      )}
    </>
  );
}
