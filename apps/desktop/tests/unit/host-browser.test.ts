import { describe, expect, it } from 'vitest';
import type { HostGroup, SavedHost } from '../../src/shared/hosts.js';
import {
  badgeHue,
  breadcrumb,
  childFolders,
  initials,
  visibleHosts,
} from '../../src/renderer/src/features/hosts/host-browser.js';

function host(name: string, groupPath?: string, tags?: string[]): SavedHost {
  return {
    id: name,
    name,
    address: `${name}.example.com`,
    port: 22,
    username: 'ops',
    protocol: 'ssh',
    groupPath,
    tags,
  } as SavedHost;
}
const group = (path: string) => ({ path }) as HostGroup;

const groups = [group('Work'), group('Work/Production'), group('Home')];
const hosts = [
  host('laptop'),
  host('web', 'Work', ['prod']),
  host('db', 'Work/Production', ['prod', 'db']),
  host('pi', 'Home'),
];
const searchText = (item: SavedHost) => [item.name, item.address];

describe('host browser', () => {
  it('lists folders one level below the current group with nested host counts', () => {
    expect(childFolders(groups, hosts, '')).toEqual([
      { path: 'Home', name: 'Home', hostCount: 1 },
      { path: 'Work', name: 'Work', hostCount: 2 },
    ]);
    expect(childFolders(groups, hosts, 'Work')).toEqual([
      { path: 'Work/Production', name: 'Production', hostCount: 1 },
    ]);
    expect(childFolders(groups, hosts, 'Work/Production')).toEqual([]);
  });

  it('shows a folder for hosts whose group has no saved record', () => {
    expect(childFolders([], [host('x', 'Lab/Rack')], '')).toEqual([
      { path: 'Lab', name: 'Lab', hostCount: 1 },
    ]);
  });

  it('does not treat a group with a shared prefix as nested', () => {
    const items = [host('a', 'Work'), host('b', 'Workshop')];
    expect(childFolders([group('Work'), group('Workshop')], items, '')).toEqual([
      { path: 'Work', name: 'Work', hostCount: 1 },
      { path: 'Workshop', name: 'Workshop', hostCount: 1 },
    ]);
  });

  it('shows only direct hosts while browsing', () => {
    const names = (folder: string) =>
      visibleHosts(hosts, folder, { query: '', tag: '', searchText }).map((item) => item.name);
    expect(names('')).toEqual(['laptop']);
    expect(names('Work')).toEqual(['web']);
  });

  it('includes nested hosts while searching or filtering by tag', () => {
    expect(
      visibleHosts(hosts, 'Work', { query: '', tag: 'prod', searchText }).map((h) => h.name),
    ).toEqual(['db', 'web']);
    expect(
      visibleHosts(hosts, '', { query: ' DB.EXAMPLE ', tag: '', searchText }).map((h) => h.name),
    ).toEqual(['db']);
    expect(visibleHosts(hosts, 'Home', { query: 'db', tag: '', searchText })).toEqual([]);
  });

  it('builds breadcrumbs for nested groups', () => {
    expect(breadcrumb('')).toEqual([]);
    expect(breadcrumb('Work/Production')).toEqual([
      { name: 'Work', path: 'Work' },
      { name: 'Production', path: 'Work/Production' },
    ]);
  });

  it('derives badge initials and a stable hue', () => {
    expect(initials('prod-web-01')).toBe('PW');
    expect(initials('staging')).toBe('ST');
    expect(initials('home pi')).toBe('HP');
    expect(initials('***')).toBe('?');
    expect(badgeHue('prod-web-01')).toBe(badgeHue('prod-web-01'));
    expect(badgeHue('prod-web-01')).toBeGreaterThanOrEqual(0);
    expect(badgeHue('prod-web-01')).toBeLessThan(360);
  });
});
