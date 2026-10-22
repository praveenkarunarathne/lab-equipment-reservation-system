const labels = {
  available: 'Available',
  maintenance: 'Maintenance',
  unavailable: 'Unavailable',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-${status}`}>{labels[status]}</span>
  );
}
