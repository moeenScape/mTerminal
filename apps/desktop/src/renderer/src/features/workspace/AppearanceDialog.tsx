import { useEffect, useRef } from 'react';
import {
  defaultTerminalAppearance,
  terminalFontLabels,
  terminalThemeLabels,
  type TerminalAppearance,
  type TerminalCursor,
  type TerminalFont,
  type TerminalTheme,
} from './appearance';

/** Per-tab terminal appearance controls, shown as a modal from the terminal menu. */
export function AppearanceDialog({
  title,
  value,
  onChange,
  onClose,
}: {
  title: string;
  value: TerminalAppearance;
  onChange: (value: TerminalAppearance) => void;
  onClose: () => void;
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
      className="terminal-dialog"
      aria-labelledby="appearance-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="appearance-dialog-title">Appearance of “{title}”</h2>
      <div className="appearance-controls">
        <label>
          Theme
          <select
            value={value.theme}
            onChange={(event) => onChange({ ...value, theme: event.target.value as TerminalTheme })}
          >
            {Object.entries(terminalThemeLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Font
          <select
            value={value.font}
            onChange={(event) => onChange({ ...value, font: event.target.value as TerminalFont })}
          >
            {Object.entries(terminalFontLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Font size
          <select
            value={value.fontSize}
            onChange={(event) => onChange({ ...value, fontSize: Number(event.target.value) })}
          >
            {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label>
          Zoom
          <select
            value={value.zoom}
            onChange={(event) => onChange({ ...value, zoom: Number(event.target.value) })}
          >
            {[75, 90, 100, 110, 125, 150].map((zoom) => (
              <option key={zoom} value={zoom}>
                {zoom}%
              </option>
            ))}
          </select>
        </label>
        <label>
          Cursor
          <select
            value={value.cursor}
            onChange={(event) =>
              onChange({ ...value, cursor: event.target.value as TerminalCursor })
            }
          >
            <option value="block">Block</option>
            <option value="bar">Bar</option>
            <option value="underline">Underline</option>
          </select>
        </label>
        <label className="appearance-check">
          <input
            type="checkbox"
            checked={value.blink}
            onChange={(event) => onChange({ ...value, blink: event.target.checked })}
          />
          Blink cursor
        </label>
      </div>
      <p className="dialog-note">Changes apply to this terminal tab for this app session.</p>
      <div className="dialog-actions">
        <button type="button" onClick={() => onChange(defaultTerminalAppearance)}>
          Reset appearance
        </button>
        <button type="button" className="primary-button" autoFocus onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
