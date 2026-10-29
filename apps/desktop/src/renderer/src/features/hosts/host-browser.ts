import type { HostGroup, SavedHost } from '../../../../shared/hosts.js';

/** A folder shown while browsing: a group directly inside the current one. */
export interface GroupFolder {
  path: string;
  name: string;
  /** Hosts in this group and all of its nested groups. */
  hostCount: number;
}

function inside(path: string | undefined, parent: string): boolean {
  if (!parent) return true;
  return path === parent || (path?.startsWith(parent + '/') ?? false);
}

/** Groups one level below `parent` ('' is the top level), sorted by name. */
export function childFolders(
  groups: HostGroup[],
  hosts: SavedHost[],
  parent: string,
): GroupFolder[] {
  const prefix = parent ? parent + '/' : '';
  const names = new Set<string>();
  // Include host paths too, so a host in a group without a saved record still has a folder.
  for (const path of [...groups.map((group) => group.path), ...hosts.map((h) => h.groupPath)]) {
    if (!path?.startsWith(prefix) || path === parent) continue;
    names.add(path.slice(prefix.length).split('/')[0]!);
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const path = prefix + name;
      return { path, name, hostCount: hosts.filter((host) => inside(host.groupPath, path)).length };
    });
}

/**
 * Hosts to show for the current folder. While browsing, only hosts directly in the
 * folder appear; while searching or filtering by tag, matches from nested groups appear too.
 */
export function visibleHosts(
  hosts: SavedHost[],
  folder: string,
  filter: { query: string; tag: string; searchText: (host: SavedHost) => string[] },
): SavedHost[] {
  const query = filter.query.trim().toLowerCase();
  const flat = query.length > 0 || filter.tag.length > 0;
  return hosts
    .filter((host) => (flat ? inside(host.groupPath, folder) : (host.groupPath ?? '') === folder))
    .filter((host) => !filter.tag || (host.tags ?? []).includes(filter.tag))
    .filter(
      (host) =>
        !query || filter.searchText(host).some((value) => value.toLowerCase().includes(query)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Breadcrumb segments for a group path, each with the path it opens. */
export function breadcrumb(path: string): { name: string; path: string }[] {
  if (!path) return [];
  const parts = path.split('/');
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

/** One or two letters representing a host name. */
export function initials(name: string): string {
  const words = name
    .split(/[\s._-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[1]![0]!;
  return letters.toUpperCase();
}

/** A stable hue (0–359) for a host's badge, so the same host keeps its colour. */
export function badgeHue(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash % 360;
}
