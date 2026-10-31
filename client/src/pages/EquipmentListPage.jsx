import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth.js';
import { useApiResource } from '../api/useApiResource.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Pagination from '../components/Pagination.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';

export default function EquipmentListPage({ admin = false }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const status =
    params.get('status') ||
    (admin || user.role === 'admin' ? 'all' : 'available');
  const query = new URLSearchParams({
    page: params.get('page') ?? '1',
    limit: '12',
  });
  for (const field of ['q', 'category', 'sort'])
    if (params.get(field)) query.set(field, params.get(field));
  if (status !== 'all') query.set('status', status);
  const { data, error, loading, retry } = useApiResource(`/equipment?${query}`);

  function search(event) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [field, value] of new FormData(event.currentTarget)) {
      if (value.trim()) next.set(field, value.trim());
    }
    setParams(next);
  }
  function changePage(page) {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  }

  return (
    <section className="catalog-page">
      <div className="page-heading">
        <div>
          <h1>{admin ? 'Manage equipment' : 'Equipment'}</h1>
          <p className="page-description">
            {admin
              ? 'Add equipment, update its details and manage availability.'
              : 'Browse the catalog. Select an item to check availability and reserve a slot.'}
          </p>
        </div>
        {admin && (
          <p>
            <Link className="button-link" to="/admin/equipment/new">
              <span aria-hidden="true">+</span> Add equipment
            </Link>
          </p>
        )}
      </div>
      <form
        className="catalog-filters"
        key={params.toString()}
        onSubmit={search}
      >
        <div className="form-field">
          <label htmlFor="search">Search equipment</label>
          <input
            id="search"
            name="q"
            maxLength={80}
            placeholder="Name, asset code or location"
            defaultValue={params.get('q') ?? ''}
          />
        </div>
        <div className="form-field">
          <label htmlFor="category">Category</label>
          <input
            id="category"
            name="category"
            maxLength={50}
            defaultValue={params.get('category') ?? ''}
          />
        </div>
        <div className="form-field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="maintenance">Maintenance</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="sort">Sort by</label>
          <select
            id="sort"
            name="sort"
            defaultValue={params.get('sort') ?? 'name_asc'}
          >
            <option value="name_asc">Name A to Z</option>
            <option value="name_desc">Name Z to A</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <button type="submit">Apply filters</button>
      </form>
      {loading && <p role="status">Loading equipment…</p>}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {data && (
        <>
          <div className="results-heading">
            <p role="status">{data.pagination.total} equipment items found.</p>
          </div>
          {data.data.length === 0 ? (
            <p>No equipment matches these filters.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Asset code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Category</th>
                    <th scope="col">Location</th>
                    <th scope="col">Status</th>
                    {admin && <th scope="col">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="asset-code">{item.assetCode}</span>
                      </td>
                      <td>
                        <Link
                          className="equipment-name"
                          to={`/equipment/${item.id}`}
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td>{item.category}</td>
                      <td>{item.location}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      {admin && (
                        <td>
                          <Link
                            to={`/admin/equipment/${item.id}/edit`}
                            aria-label={`Edit ${item.name}`}
                          >
                            Edit
                          </Link>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination pagination={data.pagination} onPageChange={changePage} />
        </>
      )}
    </section>
  );
}
