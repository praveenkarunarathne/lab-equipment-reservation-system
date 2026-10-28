export default function Pagination({ pagination, onPageChange }) {
  if (pagination.totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="pagination">
      <button
        disabled={pagination.page <= 1}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {pagination.page} of {pagination.totalPages}
      </span>
      <button
        disabled={pagination.page >= pagination.totalPages}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
