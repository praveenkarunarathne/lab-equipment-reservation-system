import { Link, useParams } from 'react-router';
import { useState } from 'react';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import EquipmentLifecycleControls from '../components/EquipmentLifecycleControls.jsx';
import BookingForm from '../components/BookingForm.jsx';

export default function EquipmentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [notice, setNotice] = useState(null);
  const { data, error, loading, retry } = useApiResource(
    `/equipment/${encodeURIComponent(id)}`,
  );
  return (
    <section>
      <p>
        <Link to="/equipment">Back to equipment</Link>
      </p>
      <h1>{data?.name ?? 'Equipment details'}</h1>
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading equipment…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <>
          <StatusBadge status={data.status} />
          {data.statusReason && <p>{data.statusReason}</p>}
          <dl>
            <dt>Asset code</dt>
            <dd>{data.assetCode}</dd>
            <dt>Category</dt>
            <dd>{data.category}</dd>
            <dt>Location</dt>
            <dd>{data.location}</dd>
          </dl>
          <h2>Description</h2>
          <p className="equipment-description">
            {data.description || 'No description provided.'}
          </p>
          {user.role === 'student' && (
            <BookingForm key={data.id} equipmentId={data.id} />
          )}
          {user.role === 'admin' && (
            <p>
              <Link to={`/admin/equipment/${data.id}/edit`}>
                Edit equipment
              </Link>
            </p>
          )}
          {user.role === 'admin' && (
            <EquipmentLifecycleControls
              equipment={data}
              onChanged={(count) => {
                setNotice(
                  `Status saved. ${count} future reservation${count === 1 ? '' : 's'} cancelled.`,
                );
                retry();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
