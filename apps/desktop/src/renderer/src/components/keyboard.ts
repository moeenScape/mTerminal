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
