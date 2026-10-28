import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';

interface HostsViewProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenWorkspace: () => void;
}

export function HostsView({ query, onQueryChange, onOpenWorkspace }: HostsViewProps) {
  const searching = query.trim().length > 0;

  function clearSearch() {
    onQueryChange('');
    document.getElementById('host-search')?.focus();
  }

  return (
    <div className="page-view">
      <header className="page-header">
        <div>
          <h1>Hosts</h1>
          <p>All your connections, in one place.</p>
        </div>
        <div className="host-search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="host-search">
            Search hosts
          </label>
          <input
            id="host-search"
            type="search"
            placeholder="Search hosts…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear host search"
              onClick={clearSearch}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </header>
      <div className="list-summary">
        <span>
          All hosts <span className="count">0</span>
        </span>
        <span>No saved connections</span>
      </div>
      <div className="view-body" aria-live="polite">
        <EmptyState
          icon={searching ? 'search' : 'hosts'}
          title={searching ? 'No matching hosts' : 'Your connections start here'}
          description={
            searching
              ? `No saved hosts match “${query.trim()}”. Try another search or clear the filter.`
              : 'Saved SSH connections will live here. Adding and organizing hosts will be available in a later update.'
          }
          actionLabel={searching ? 'Clear search' : 'Open workspace'}
          onAction={searching ? clearSearch : onOpenWorkspace}
        />
      </div>
    </div>
  );
}
