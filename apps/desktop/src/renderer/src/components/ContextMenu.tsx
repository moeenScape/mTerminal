import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  danger?: boolean;
  /** Draws a divider above this item. */
  separator?: boolean;
}

export interface MenuPosition {
  x: number;
  y: number;
}

const isMac = navigator.userAgent.includes('Mac');

/** Formats a Ctrl+Shift shortcut using the platform's modifier convention. */
export function shortcutLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+Shift+${key}`;
}

/** Position for a menu opened from a button or the keyboard rather than the pointer. */
export function menuPositionFor(element: Element): MenuPosition {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

/**
 * Popup menu at a screen position. Arrow keys move between items, Escape or a click
 * outside closes it, and focus returns to the element that was focused before opening.
 */
export function ContextMenu({
  label,
  position,
  items,
  onClose,
}: {
  label: string;
  position: MenuPosition;
  items: MenuItem[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);
  const [placement, setPlacement] = useState(position);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPlacement({
      x: Math.max(4, Math.min(position.x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(position.y, window.innerHeight - height - 4)),
    });
    element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [position]);

  useEffect(() => {
    const dismiss = () => close.current();
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    }
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, []);

  useEffect(
    () => () => {
      const target = returnFocus.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    },
    [],
  );

  function keyDown(event: KeyboardEvent) {
    const enabled = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    } else return;
    event.preventDefault();
    next?.focus();
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="context-menu"
      style={{ left: placement.x, top: placement.y }}
      onKeyDown={keyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.label} role="none">
          {item.separator && <hr className="context-menu-separator" aria-hidden="true" />}
          <button
            type="button"
            role="menuitem"
            aria-label={item.label}
            tabIndex={-1}
            className={item.danger ? 'context-menu-item danger' : 'context-menu-item'}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd aria-hidden="true">{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}
