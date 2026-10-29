export const PREFERENCES_GET = 'preferences:get';
export const PREFERENCES_SAVE = 'preferences:save';
export interface Preferences {
  appearance: 'dark' | 'light';
  defaultShell: string;
  navigationShortcuts: boolean;
  rememberWindow: boolean;
  /** Save new local Bash commands to the encrypted vault history. */
  recordHistory: boolean;
  /** Show history suggestions beneath the cursor while typing. */
  autocomplete: boolean;
}
export const defaultPreferences: Preferences = {
  appearance: 'dark',
  defaultShell: '',
  navigationShortcuts: true,
  rememberWindow: true,
  recordHistory: true,
  autocomplete: true,
};
const required = ['appearance', 'defaultShell', 'navigationShortcuts', 'rememberWindow'];
/** Added later; settings files written before they existed fall back to the defaults. */
const optional = ['recordHistory', 'autocomplete'] as const;

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid preferences.');
  const p = value as Record<string, unknown>;
  const keys = Object.keys(p);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !(optional as readonly string[]).includes(key)) ||
    !['dark', 'light'].includes(String(p.appearance)) ||
    typeof p.defaultShell !== 'string' ||
    p.defaultShell.length > 1024 ||
    Array.from(p.defaultShell).some((character) => character.charCodeAt(0) < 32) ||
    typeof p.navigationShortcuts !== 'boolean' ||
    typeof p.rememberWindow !== 'boolean' ||
    optional.some((key) => key in p && typeof p[key] !== 'boolean')
  ) {
    throw new Error('Invalid preferences.');
  }
  return {
    appearance: p.appearance as Preferences['appearance'],
    defaultShell: p.defaultShell.trim(),
    navigationShortcuts: p.navigationShortcuts,
    rememberWindow: p.rememberWindow,
    recordHistory: (p.recordHistory as boolean | undefined) ?? defaultPreferences.recordHistory,
    autocomplete: (p.autocomplete as boolean | undefined) ?? defaultPreferences.autocomplete,
  };
}
