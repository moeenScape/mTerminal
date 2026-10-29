import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Opens a <dialog> as a modal for as long as the component is mounted. */
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return ref;
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Asks before an irreversible action. The confirm button shows progress while
 * `onConfirm` runs, and any error stays visible in the dialog instead of closing it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const ref = useModalDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (cause) {
      setError(errorMessage(cause, 'The action could not be completed.'));
    } finally {
      setBusy(false);
    }
  }
  // Rendered under <body> so styles of the surrounding list or dialog cannot leak in.
  return createPortal(
    <dialog
      ref={ref}
      className="terminal-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="confirm-dialog-title">{title}</h2>
        {children}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" autoFocus disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={danger ? 'danger-button' : 'primary-button'}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
