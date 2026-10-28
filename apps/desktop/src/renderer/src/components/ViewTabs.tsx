import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';

export const viewItems = [
  { id: 'hosts', label: 'Hosts', icon: 'hosts' },
  { id: 'workspace', label: 'Workspace', icon: 'terminal' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const;

export type ViewId = (typeof viewItems)[number]['id'];

interface ViewTabsProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

export function ViewTabs({ activeView, onViewChange }: ViewTabsProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % viewItems.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + viewItems.length) % viewItems.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = viewItems.length - 1;
        break;
      default:
        return;
    }

    const next = viewItems[nextIndex];
    if (!next) return;
    event.preventDefault();
    onViewChange(next.id);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#view-tab-${next.id}`)
      ?.focus();
  }

  return (
    <div className="view-tabs" role="tablist" aria-label="Workspace views">
      {viewItems.map((view, index) => (
        <button
          key={view.id}
          id={`view-tab-${view.id}`}
          type="button"
          role="tab"
          aria-selected={activeView === view.id}
          aria-controls="view-panel"
          tabIndex={activeView === view.id ? 0 : -1}
          onClick={() => onViewChange(view.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <Icon name={view.icon} />
          {view.label}
        </button>
      ))}
    </div>
  );
}
