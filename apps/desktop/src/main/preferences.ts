import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  defaultPreferences,
  validatePreferences,
  type Preferences,
} from '../shared/preferences.js';

import type { SharedVaultSettings } from '../shared/organization-vault.js';

interface WindowState {
  width: number;
  height: number;
  maximized: boolean;
}
interface Settings {
  version: 1;
  preferences: Preferences;
  window: WindowState;
}
export class PreferencesStore {
  private state: Settings = {
    version: 1,
    preferences: { ...defaultPreferences },
    window: { width: 1200, height: 800, maximized: false },
  };
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const data = JSON.parse(content) as Settings;
    if (
      data.version !== 1 ||
      !data.window ||
      !Number.isInteger(data.window.width) ||
      data.window.width < 760 ||
      data.window.width > 16000 ||
      !Number.isInteger(data.window.height) ||
      data.window.height < 520 ||
      data.window.height > 16000 ||
      typeof data.window.maximized !== 'boolean'
    )
      throw new Error('Invalid settings file; preserve it for recovery.');
    this.state = {
      version: 1,
      preferences: validatePreferences(data.preferences),
      window: data.window,
    };
  }
  get preferences(): Preferences {
    return { ...this.state.preferences };
  }
  get window(): WindowState {
    return { ...this.state.window };
  }
  save(preferences: Preferences): Promise<void> {
    const validated = validatePreferences(preferences);
    return this.saveState((current) => ({ ...current, preferences: validated }));
  }
  saveWindow(window: WindowState): Promise<void> {
    return this.saveState((current) => ({ ...current, window }));
  }
  applyPortableSettings(values: SharedVaultSettings): Promise<void> {
    return this.saveState((current) => ({
      ...current,
      preferences: validatePreferences({ ...current.preferences, ...values }),
    }));
  }
  private saveState(update: (current: Settings) => Settings): Promise<void> {
    const operation = this.writes.then(async () => {
      const next = update(this.state);
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(this.path + '.tmp', this.path);
      this.state = next;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
