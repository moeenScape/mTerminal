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
