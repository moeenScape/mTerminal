import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseInstaller } from '../release-assets.js';

const release = 'https://github.com/moeenScape/mTerminal/releases/download/v0.1.0/';

function asset(name, overrides = {}) {
  return {
    name,
    state: 'uploaded',
    browser_download_url: release + name,
    size: 1024,
    ...overrides,
  };
}

test('maps installers only to their intended platform and labels the architecture', () => {
  assert.equal(
    releaseInstaller(asset('mterminal_0.1.0_amd64.deb'), 'linux')?.architecture,
    '64-bit (x64)',
  );
  assert.equal(
    releaseInstaller(asset('mTerminal-0.1.0-arm64.dmg'), 'macos')?.architecture,
    'Apple Silicon',
  );
  assert.equal(
    releaseInstaller(asset('mTerminal-Setup-0.1.0-x64.exe'), 'windows')?.extension,
    'exe',
  );
  assert.equal(releaseInstaller(asset('mTerminal-0.1.0-arm64.dmg'), 'windows'), undefined);
  assert.equal(
    releaseInstaller(asset('mTerminal-Setup-0.1.0-x64.exe.blockmap'), 'windows'),
    undefined,
  );
});

test('ignores incomplete uploads and links outside the project release', () => {
  const name = 'mterminal_0.1.0_amd64.deb';
  assert.equal(releaseInstaller(asset(name, { state: 'new' }), 'linux'), undefined);
  assert.equal(
    releaseInstaller(
      asset(name, { browser_download_url: 'https://example.test/' + name }),
      'linux',
    ),
    undefined,
  );
  assert.equal(
    releaseInstaller(asset(name, { browser_download_url: release + 'different.deb' }), 'linux'),
    undefined,
  );
});
