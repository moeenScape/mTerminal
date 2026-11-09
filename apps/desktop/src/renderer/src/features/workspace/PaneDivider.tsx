import { useRef } from 'react';
import type { PaneDivider as Divider } from './pane-layout';

export function PaneDivider({
  divider,
  index,
  onResize,
}: {
  divider: Divider;
  index: number;
  onResize: (ratio: number) => void;
}) {
  const drag = useRef<{ pointerId: number; ratio: number } | null>(null);
  const vertical = divider.direction === 'right';
  const resize = (ratio: number) =>
    onResize(Math.max(divider.minimum, Math.min(divider.maximum, ratio)));
  return (
    <div
      role="separator"
      tabIndex={0}
      className="pane-divider"
      aria-label={`Resize panes ${index + 1}`}
      aria-describedby="pane-resize-help"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(divider.minimum * 100)}
      aria-valuemax={Math.round(divider.maximum * 100)}
      aria-valuenow={Math.round(divider.ratio * 100)}
      aria-controls={divider.paneIds.map((id) => `terminal-panel-${id}`).join(' ')}
      style={
        vertical
          ? {
              left: divider.left + divider.width * divider.ratio - 3,
              top: divider.top,
              width: 6,
              height: divider.height,
            }
          : {
              left: divider.left,
              top: divider.top + divider.height * divider.ratio - 3,
              width: divider.width,
              height: 6,
            }
      }
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, ratio: divider.ratio };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const canvas = event.currentTarget.parentElement!.getBoundingClientRect();
        resize(
          vertical
            ? (event.clientX - canvas.left - divider.left) / divider.width
            : (event.clientY - canvas.top - divider.top) / divider.height,
        );
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) onResize(drag.current.ratio);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => resize(0.5)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault();
          onResize(drag.current.ratio);
          const pointerId = drag.current.pointerId;
          drag.current = null;
          event.currentTarget.releasePointerCapture(pointerId);
          return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        const negative = vertical ? 'ArrowLeft' : 'ArrowUp';
        const positive = vertical ? 'ArrowRight' : 'ArrowDown';
        let ratio: number;
        if (event.key === negative) ratio = divider.ratio - 0.02;
        else if (event.key === positive) ratio = divider.ratio + 0.02;
        else if (event.key === 'Home') ratio = divider.minimum;
        else if (event.key === 'End') ratio = divider.maximum;
        else if (event.key === 'Enter') ratio = 0.5;
        else return;
        event.preventDefault();
        event.stopPropagation();
        resize(ratio);
      }}
    />
  );
}
