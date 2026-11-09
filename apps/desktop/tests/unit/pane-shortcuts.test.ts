import { describe, expect, it } from 'vitest';
import { paneShortcut } from '../../src/renderer/src/components/keyboard.js';
function key(patch: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'ArrowRight',
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    getModifierState: () => false,
    ...patch,
  } as KeyboardEvent;
}
describe('pane shortcut routing', () => {
  it('distinguishes focus and divider resizing for all four directions', () => {
    for (const direction of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(paneShortcut(key({ key: direction }))).toBe('focus');
      expect(paneShortcut(key({ key: direction, ctrlKey: true }))).toBe('resize');
    }
  });
  it('preserves ordinary shell keys, composition, AltGraph and other shortcuts', () => {
    for (const patch of [
      { altKey: false },
      { shiftKey: false },
      { metaKey: true },
      { isComposing: true },
      { getModifierState: () => true },
      { key: 'a' },
      { key: 'Tab' },
      { key: '1' },
    ]) {
      expect(paneShortcut(key(patch))).toBeUndefined();
    }
  });
});
