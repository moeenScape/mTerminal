export function isWorkspaceShortcut(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    !event.getModifierState('AltGraph') &&
    event.ctrlKey &&
    event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    /^[123]$/.test(event.key)
  );
}

export function isTerminalSearchShortcut(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    !event.getModifierState('AltGraph') &&
    !event.altKey &&
    event.key.toLowerCase() === 'f' &&
    ((event.metaKey && !event.ctrlKey && !event.shiftKey) ||
      (event.ctrlKey && event.shiftKey && !event.metaKey))
  );
}

/** Pane shortcuts are handled in capture phase so no bytes reach the shell. */
export function paneShortcut(event: KeyboardEvent): 'focus' | 'resize' | undefined {
  if (
    event.isComposing ||
    event.getModifierState('AltGraph') ||
    event.metaKey ||
    !event.altKey ||
    !event.shiftKey ||
    !/^Arrow(Left|Right|Up|Down)$/.test(event.key)
  )
    return;
  return event.ctrlKey ? 'resize' : 'focus';
}
