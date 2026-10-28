import { useEffect, useRef } from 'react';
import type { PreparedPaste } from '../../../../shared/clipboard';

export function PasteDialog({
  title,
  paste,
  onConfirm,
  onCancel,
}: {
  title: string;
  paste: PreparedPaste;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="terminal-dialog paste-dialog"
      aria-labelledby="paste-dialog-heading"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h2 id="paste-dialog-heading">Paste into “{title}”?</h2>
        <p>
          This text contains line breaks or control characters and may run commands. Review it
          before pasting.
        </p>
        <pre className="paste-preview" aria-label="Paste preview">
          {paste.preview}
        </pre>
        <p>
          {paste.lines} {paste.lines === 1 ? 'line' : 'lines'}
          {paste.truncated ? '. Preview truncated; the full text will be pasted.' : '.'}
        </p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Paste into terminal</button>
        </div>
      </form>
    </dialog>
  );
}
