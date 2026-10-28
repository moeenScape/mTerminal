import { EmptyState } from '../../components/EmptyState';

export function WorkspaceView({ onBrowseHosts }: { onBrowseHosts: () => void }) {
  return (
    <div className="page-view">
      <header className="page-header">
        <div>
          <h1>Workspace</h1>
          <p>A place for your terminal sessions.</p>
        </div>
      </header>
      <div className="list-summary">
        <span>
          Sessions <span className="count">0</span>
        </span>
        <span>Nothing running</span>
      </div>
      <div className="view-body">
        <EmptyState
          icon="terminal"
          title="No active sessions"
          description="Your terminals will open here. Local shell support is coming in a later update."
          actionLabel="Browse hosts"
          onAction={onBrowseHosts}
        />
      </div>
    </div>
  );
}
