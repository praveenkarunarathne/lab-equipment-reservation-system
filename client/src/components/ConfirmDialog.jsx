import { useEffect, useId, useRef } from 'react';

export default function ConfirmDialog({
  title,
  children,
  busy,
  error,
  onConfirm,
  onCancel,
  confirmLabel,
}) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={`${titleId}-description`}>{children}</div>
      {error && (
        <p role="alert">
          {error.fieldErrors?.['body.reason']?.join(' ') ?? error.message}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
