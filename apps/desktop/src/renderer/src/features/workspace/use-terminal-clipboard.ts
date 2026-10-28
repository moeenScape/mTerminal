import { useCallback, useRef, useState, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { preparePaste, validClipboardText, type PreparedPaste } from '../../../../shared/clipboard';
import { failureMessages } from '../../../../shared/failures';

function clipboardFailure(error: unknown): string {
  return error instanceof Error && error.message === failureMessages['clipboard-too-large']
    ? error.message
    : failureMessages['clipboard-unavailable'];
}
interface PendingPaste extends PreparedPaste {
  sessionId: string;
  terminal: Terminal;
}
export function useTerminalClipboard(
  terminal: RefObject<Terminal | null>,
  session: RefObject<string | null>,
  host: RefObject<HTMLElement | null>,
  ready: RefObject<boolean>,
) {
  const [selected, setSelected] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingPaste | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const focusFrame = useRef<number | undefined>(undefined);
  const available = useCallback(
    (term: Terminal, id: string) =>
      ready.current &&
      terminal.current === term &&
      session.current === id &&
      Boolean(host.current?.clientWidth),
    [terminal, session, host, ready],
  );
  const focus = useCallback(
    (term: Terminal, id: string) => {
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        if (available(term, id)) term.focus();
      });
    },
    [available],
  );
  const commit = useCallback(
    (request: PendingPaste) => {
      setPending(null);
      if (!available(request.terminal, request.sessionId)) {
        setNotice('Paste cancelled: the target session is no longer active.');
        return;
      }
      request.terminal.paste(request.text);
      setNotice('Text pasted.');
      focus(request.terminal, request.sessionId);
    },
    [available, focus],
  );
  const pasteText = useCallback(
    (text: string, term: Terminal, id: string) => {
      if (!available(term, id)) return;
      if (!validClipboardText(text)) {
        setNotice(failureMessages['clipboard-too-large']);
        return;
      }
      if (!text) {
        setNotice('Clipboard is empty.');
        return;
      }
      const request = { ...preparePaste(text), sessionId: id, terminal: term };
      setNotice('');
      if (request.confirm) setPending(request);
      else commit(request);
    },
    [available, commit],
  );
  const paste = useCallback(async () => {
    const term = terminal.current;
    const id = session.current;
    if (!term || !id || !available(term, id)) return;
    const token = ++generation.current;
    setBusy(true);
    try {
      const text = await window.mterminal.readClipboardText();
      if (token === generation.current) pasteText(text, term, id);
    } catch (error) {
      if (token === generation.current && terminal.current === term)
        setNotice(clipboardFailure(error));
    } finally {
      if (token === generation.current && terminal.current === term) setBusy(false);
    }
  }, [terminal, session, available, pasteText]);
  const copy = useCallback(async () => {
    const term = terminal.current;
    if (!term) return;
    const text = term.getSelection();
    if (!text) {
      setNotice('Select terminal text to copy.');
      return;
    }
    if (!validClipboardText(text)) {
      setNotice(failureMessages['clipboard-too-large']);
      return;
    }
    try {
      await window.mterminal.writeClipboardText(text);
      if (terminal.current === term) setNotice('Selection copied.');
    } catch (error) {
      if (terminal.current === term) setNotice(clipboardFailure(error));
    }
  }, [terminal]);
  const attach = useCallback(
    (term: Terminal, element: HTMLElement) => {
      const selection = term.onSelectionChange(() => setSelected(term.hasSelection()));
      const osc = term.parser.registerOscHandler(52, () => true);
      const onPaste = (event: ClipboardEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = session.current;
        if (!id || !ready.current) {
          setNotice('Wait for a running shell before pasting.');
          return;
        }
        if (event.clipboardData) pasteText(event.clipboardData.getData('text/plain'), term, id);
        else void paste();
      };
      const onCopy = (event: ClipboardEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const text = term.getSelection();
        if (!text) {
          setNotice('Select terminal text to copy.');
          return;
        }
        if (!validClipboardText(text)) {
          setNotice(failureMessages['clipboard-too-large']);
          return;
        }
        if (event.clipboardData) {
          event.clipboardData.setData('text/plain', text);
          setNotice('Selection copied.');
        } else void copy();
      };
      element.addEventListener('paste', onPaste, true);
      element.addEventListener('copy', onCopy, true);
      element.addEventListener('cut', onCopy, true);
      return () => {
        generation.current++;
        if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
        selection.dispose();
        osc.dispose();
        element.removeEventListener('paste', onPaste, true);
        element.removeEventListener('copy', onCopy, true);
        element.removeEventListener('cut', onCopy, true);
      };
    },
    [session, ready, pasteText, paste, copy],
  );
  return {
    selected,
    notice,
    pending,
    busy,
    attach,
    copy,
    paste,
    confirm: () => pending && commit(pending),
    cancel: () => {
      setPending(null);
      setNotice('Paste cancelled.');
      if (pending) focus(pending.terminal, pending.sessionId);
    },
  };
}
