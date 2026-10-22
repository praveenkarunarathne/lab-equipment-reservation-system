export default function ErrorMessage({ error, onRetry }) {
  return (
    <div>
      <p role="alert">{error.message}</p>
      <button onClick={onRetry}>Try again</button>
    </div>
  );
}
