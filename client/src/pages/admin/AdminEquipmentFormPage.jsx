import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/useAuth.js';
import { useApiResource } from '../../api/useApiResource.js';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const fields = [
  { name: 'assetCode', label: 'Asset code', max: 30 },
  { name: 'name', label: 'Name', max: 100 },
  { name: 'category', label: 'Category', max: 50 },
  { name: 'location', label: 'Location', max: 100 },
  { name: 'description', label: 'Description', max: 1000 },
];

function EquipmentForm({ initial }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await request(initial ? `/equipment/${initial.id}` : '/equipment', {
        method: initial ? 'PATCH' : 'POST',
        body,
      });
      navigate('/admin/equipment');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <p>
        <Link to="/admin/equipment">Back to manage equipment</Link>
      </p>
      <h1>{initial ? 'Edit equipment' : 'Add equipment'}</h1>
      {error && <p role="alert">{error.message}</p>}
      <form className="equipment-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          {fields.map((field) => {
            const messages = error?.fieldErrors?.[`body.${field.name}`];
            const input = {
              id: field.name,
              name: field.name,
              required: field.name !== 'description',
              maxLength: field.max,
              defaultValue: initial?.[field.name] ?? '',
              'aria-invalid': Boolean(messages),
              'aria-describedby': messages ? `${field.name}-error` : undefined,
            };
            return (
              <div className="form-field" key={field.name}>
                <label htmlFor={field.name}>{field.label}</label>
                {field.name === 'description' ? (
                  <textarea {...input} rows={5} />
                ) : (
                  <input {...input} />
                )}
                {messages && (
                  <small id={`${field.name}-error`} className="field-error">
                    {messages.join(' ')}
                  </small>
                )}
              </div>
            );
          })}
          <button type="submit">
            {busy ? 'Saving…' : initial ? 'Save equipment' : 'Create equipment'}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function EquipmentEditor({ id }) {
  const { data, error, loading, retry } = useApiResource(
    `/equipment/${encodeURIComponent(id)}`,
  );
  if (loading) return <p role="status">Loading equipment…</p>;
  if (error) return <ErrorMessage error={error} onRetry={retry} />;
  return <EquipmentForm initial={data} />;
}

export default function AdminEquipmentFormPage() {
  const { id } = useParams();
  return id ? <EquipmentEditor key={id} id={id} /> : <EquipmentForm />;
}
