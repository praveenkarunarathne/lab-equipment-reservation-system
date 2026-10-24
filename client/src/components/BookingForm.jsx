import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import ErrorMessage from './ErrorMessage.jsx';

export default function BookingForm({ equipmentId }) {
  const { request } = useAuth();
  const { data, loading, error, retry } = useApiResource(
    `/equipment/${equipmentId}/availability`,
  );
  const [startAt, setStartAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [booked, setBooked] = useState(false);
  async function book(event) {
    event.preventDefault();
    if (busy || !startAt) return;
    setBusy(true);
    setFailure(null);
    setBooked(false);
    try {
      await request('/reservations', {
        method: 'POST',
        body: { equipmentId, startAt },
      });
      setBooked(true);
      setStartAt('');
      retry();
    } catch (failure) {
      setFailure(failure);
      if (failure.status === 409 || failure.fieldErrors?.['body.startAt']) {
        setStartAt('');
        retry();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="booking-form">
      <h2>Reserve a slot</h2>
      <p>One-hour slots, Monday–Friday. All times are in Asia/Colombo.</p>
      {booked && (
        <p role="status">
          Reservation confirmed.{' '}
          <Link to="/reservations">View my reservations</Link>
        </p>
      )}
      {failure && <p role="alert">{failure.message}</p>}
      {loading && <p role="status">Loading availability…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data &&
        (!data.bookable ? (
          <p>This equipment is currently unavailable for booking.</p>
        ) : data.slots.length === 0 ? (
          <p>No slots are available in the next 14 days.</p>
        ) : (
          <form onSubmit={book}>
            <fieldset disabled={busy}>
              <div className="form-field">
                <label htmlFor="booking-slot">Available slot</label>
                <select
                  id="booking-slot"
                  required
                  value={startAt}
                  onChange={(event) => setStartAt(event.target.value)}
                  aria-describedby={
                    failure?.fieldErrors?.['body.startAt']
                      ? 'slot-error'
                      : undefined
                  }
                >
                  <option value="">Choose a slot</option>
                  {data.slots.map((slot) => (
                    <option key={slot.startAt} value={slot.startAt}>
                      {slot.label}
                    </option>
                  ))}
                </select>
                {failure?.fieldErrors?.['body.startAt'] && (
                  <span id="slot-error" className="field-error">
                    {failure.fieldErrors['body.startAt'].join(' ')}
                  </span>
                )}
              </div>
              <button type="submit">{busy ? 'Booking…' : 'Book slot'}</button>
            </fieldset>
          </form>
        ))}
      <button
        type="button"
        disabled={loading || busy}
        onClick={() => {
          setStartAt('');
          retry();
        }}
      >
        Refresh availability
      </button>
    </section>
  );
}
