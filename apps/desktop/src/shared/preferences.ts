export const PREFERENCES_GET = 'preferences:get';
export const PREFERENCES_SAVE = 'preferences:save';
export interface Preferences {
  appearance: 'dark' | 'light';
  defaultShell: string;
  navigationShortcuts: boolean;
  rememberWindow: boolean;
}
export const defaultPreferences: Preferences = {
  appearance: 'dark',
  defaultShell: '',
  navigationShortcuts: true,
  rememberWindow: true,
};
export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid preferences.');
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).length !== 4 ||
    !['dark', 'light'].includes(String(p.appearance)) ||
    typeof p.defaultShell !== 'string' ||
    p.defaultShell.length > 1024 ||
    Array.from(p.defaultShell).some((character) => character.charCodeAt(0) < 32) ||
    typeof p.navigationShortcuts !== 'boolean' ||
    typeof p.rememberWindow !== 'boolean'
  ) {
    throw new Error('Invalid preferences.');
  }
  return {
    appearance: p.appearance as Preferences['appearance'],
    defaultShell: p.defaultShell.trim(),
    navigationShortcuts: p.navigationShortcuts,
    rememberWindow: p.rememberWindow,
  };
}
