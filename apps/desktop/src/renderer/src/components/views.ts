export const viewItems = [
  { id: 'hosts', label: 'Hosts', icon: 'hosts' },
  { id: 'workspace', label: 'Workspace', icon: 'terminal' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const;

export type ViewId = (typeof viewItems)[number]['id'];
