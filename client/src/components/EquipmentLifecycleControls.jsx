import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import ConfirmDialog from './ConfirmDialog.jsx';

export default function EquipmentLifecycleControls({ equipment, onChanged }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(equipment.status);
  const [reason, setReason] = useState(equipment.statusReason ?? '');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  function cancel() {
    setPending(null);
    setError(null);
  }
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (pending.type === 'archive') {
        await request(`/equipment/${equipment.id}`, { method: 'DELETE' });
        navigate('/admin/equipment');
      } else {
        const result = await request(`/equipment/${equipment.id}/status`, {
          method: 'PATCH',
          body: pending.body,
        });
        setPending(null);
        onChanged(result.cancelledReservationCount);
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lifecycle-controls">
      <h2>Equipment status</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setPending({
            type: 'status',
            body: { status, ...(status !== 'available' && { reason }) },
          });
        }}
      >
        <div className="form-field">
          <label htmlFor="equipment-status">Status</label>
          <select
            id="equipment-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="available">Available</option>
            <option value="maintenance">Maintenance</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
        {status !== 'available' && (
          <div className="form-field">
            <label htmlFor="status-reason">Reason</label>
            <textarea
              id="status-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              required
              rows={3}
            />
          </div>
        )}
        <button type="submit" disabled={busy}>
          Update status
        </button>
      </form>
      <h2>Archive equipment</h2>
      <p>
        Remove this equipment from the catalog while preserving its history.
      </p>
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={() => {
          setError(null);
          setPending({ type: 'archive' });
        }}
      >
        Archive equipment
      </button>
      {pending && (
        <ConfirmDialog
          title={
            pending.type === 'archive'
              ? 'Archive equipment?'
              : 'Change equipment status?'
          }
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={cancel}
          confirmLabel={
            pending.type === 'archive'
              ? 'Confirm archive'
              : 'Confirm status change'
          }
        >
          {pending.type === 'archive' ? (
            <p>
              Archiving {equipment.name} hides it from the catalog and cancels
              all future active reservations. Existing history is preserved.
            </p>
          ) : pending.body.status === 'available' ? (
            <p>
              Return {equipment.name} to available. Cancelled reservations will
              stay cancelled.
            </p>
          ) : (
            <p>
              Changing {equipment.name} to {pending.body.status} will cancel all
              future active reservations. Reservations that have already started
              will remain unchanged.
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
