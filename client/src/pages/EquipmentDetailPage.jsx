import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';

export default function EquipmentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, retry } = useApiResource(
    `/equipment/${encodeURIComponent(id)}`,
  );
  return (
    <section>
      <p>
        <Link to="/equipment">Back to equipment</Link>
      </p>
      <h1>{data?.name ?? 'Equipment details'}</h1>
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
          {user.role === 'admin' && (
            <p>
              <Link to={`/admin/equipment/${data.id}/edit`}>
                Edit equipment
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
