import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreferencesStore } from '../../src/main/preferences.js';
import { defaultPreferences, validatePreferences } from '../../src/shared/preferences.js';

describe('preferences', () => {
  it('rejects malformed IPC payloads', () => {
    for (const value of [
      null,
      [],
      {},
      { ...defaultPreferences, defaultShell: 'bash\ncommand' },
      { ...defaultPreferences, extra: true },
    ]) {
      expect(() => validatePreferences(value)).toThrow();
    }
  });
  it('fills in newer settings for files saved before they existed', () => {
    const older = Object.fromEntries(
      Object.entries(defaultPreferences).filter(
        ([key]) => key !== 'recordHistory' && key !== 'autocomplete',
      ),
    );
    expect(validatePreferences(older)).toEqual(defaultPreferences);
    expect(validatePreferences(older).recordHistory).toBe(false);
    expect(defaultPreferences.recordHistory).toBe(false);
    expect(validatePreferences({ ...defaultPreferences, recordHistory: true }).recordHistory).toBe(
      true,
    );
    expect(() => validatePreferences({ ...defaultPreferences, autocomplete: 'yes' })).toThrow();
  });
  it('persists settings and preserves malformed files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mterminal-settings-'));
    const path = join(directory, 'preferences.json');
    try {
      const store = new PreferencesStore(path);
      await store.load();
      await store.save({ ...defaultPreferences, appearance: 'light', defaultShell: '/bin/bash' });
      const reloaded = new PreferencesStore(path);
      await reloaded.load();
      expect(reloaded.preferences.appearance).toBe('light');
      expect(reloaded.preferences.defaultShell).toBe('/bin/bash');
      await writeFile(path, 'broken');
      await expect(new PreferencesStore(path).load()).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('broken');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
