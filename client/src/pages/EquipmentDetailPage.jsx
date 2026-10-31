import { Link, useParams } from 'react-router';
import { useState } from 'react';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import EquipmentLifecycleControls from '../components/EquipmentLifecycleControls.jsx';
import BookingForm from '../components/BookingForm.jsx';
import Icon from '../components/Icon.jsx';

export default function EquipmentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [notice, setNotice] = useState(null);
  const { data, error, loading, retry } = useApiResource(
    `/equipment/${encodeURIComponent(id)}`,
  );
  return (
    <section className="equipment-detail">
      <p className="back-link">
        <Link to="/equipment">Back to equipment</Link>
      </p>
      <div className="page-heading">
        <div>
          <h1>{data?.name ?? 'Equipment details'}</h1>
          <p className="page-description">
            {data
              ? `${data.assetCode}, ${data.category}, ${data.location}`
              : 'Equipment information and availability.'}
          </p>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading equipment…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <div className="detail-grid">
          <div className="detail-summary">
            <div className="detail-summary-body">
              <h2>Equipment details</h2>
              <StatusBadge status={data.status} />
              {data.statusReason && (
                <p className="status-reason">{data.statusReason}</p>
              )}
              <dl className="equipment-metadata">
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
              <p className="detail-link">
                {user.role === 'student' ? (
                  <Link to={`/fault-reports/new?equipmentId=${data.id}`}>
                    Report a fault
                  </Link>
                ) : (
                  <Link to={`/admin/equipment/${data.id}/edit`}>
                    Edit equipment
                  </Link>
                )}
                <Icon name="arrow" />
              </p>
            </div>
          </div>
          <div className="detail-actions">
            {user.role === 'student' ? (
              <BookingForm key={data.id} equipmentId={data.id} />
            ) : (
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
          </div>
        </div>
      )}
    </section>
  );
}
