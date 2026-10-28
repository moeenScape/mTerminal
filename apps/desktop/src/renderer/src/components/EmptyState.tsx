import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon name={icon} className="empty-state-icon" />
      <h2>{title}</h2>
      <p>{description}</p>
      <button type="button" className="secondary-button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
