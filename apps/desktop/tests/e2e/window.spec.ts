import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const desktopDirectory = fileURLToPath(new URL('../../', import.meta.url));
const electronExecutable = createRequire(import.meta.url)('electron') as string;
let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'mterminal-e2e-'));

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;

  application = await _electron.launch({
    executablePath: electronExecutable,
    chromiumSandbox: true,
    args: [desktopDirectory],
    env: { ...env, MTERMINAL_USER_DATA: userData },
  });
  page = await application.firstWindow();
});

test.afterEach(async () => {
  try {
    if (application) {
      await application.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      });
      await application.close();
    }
  } finally {
    if (userData) await rm(userData, { recursive: true, force: true });
  }
});

test('opens the desktop window and reads app information through preload', async () => {
  await expect(page).toHaveTitle('mTerminal');
  await expect(page.getByRole('heading', { name: 'Hosts', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Application ready');
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  expect(info.name).toBe('mTerminal');
  expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(['linux', 'darwin', 'win32']).toContain(info.platform);
});

test('exposes only the intended bridge and no Node globals', async () => {
  const exposed = await page.evaluate(() => ({
    methods: Object.keys(window.mterminal),
    nodeProcess: typeof Reflect.get(window, 'process'),
    nodeRequire: typeof Reflect.get(window, 'require'),
  }));
  expect(exposed).toEqual({
    methods: [
      'answerSshChallenge',
      'onSshChallenge',
      'openSshTerminal',
      'listHostGroups',
      'saveHostGroup',
      'deleteHostGroup',
      'listHosts',
      'saveHost',
      'deleteHost',
      'readClipboardText',
      'writeClipboardText',
      'getShells',
      'openTerminal',
      'writeTerminal',
      'resizeTerminal',
      'ackTerminal',
      'closeTerminal',
      'onTerminalEvent',
      'getPreferences',
      'savePreferences',
      'getAppInfo',
    ],
    nodeProcess: 'undefined',
    nodeRequire: 'undefined',
  });
});

test('blocks popups and renderer-initiated navigation', async () => {
  expect(await page.evaluate(() => window.open('https://example.com/'))).toBeNull();

  const prevented = await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (!contents) throw new Error('Application window is missing.');
    return new Promise<boolean>((resolve, reject) => {
      contents.once('will-frame-navigate', (event) => resolve(event.defaultPrevented));
      void contents
        .executeJavaScript("window.location.assign('https://example.com/')")
        .catch(reject);
    });
  });
  expect(prevented).toBe(true);
  await expect(page.getByRole('heading', { name: 'Hosts', exact: true })).toBeVisible();
});

test('retains the bridge after reload and uses the production CSP', async () => {
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Application ready');
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toContain('unsafe-inline');
  expect(policy).not.toContain('__CSP__');
});

test('switches views through navigation and shows real application information', async () => {
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start local shell' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Workspace', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  await expect(page.locator('dd').filter({ hasText: info.version })).toHaveText(info.version);
  await expect(navigation.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('searches an empty host list, preserves the query between views, and clears it', async () => {
  const search = page.getByRole('searchbox', { name: 'Search hosts' });
  await search.fill('staging');
  await expect(page.getByRole('heading', { name: 'No matching hosts' })).toBeVisible();
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
  await expect(search).toHaveValue('staging');
  await page.getByRole('button', { name: 'Clear host search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Your connections start here' })).toBeVisible();
});

test('supports arrow, Home, and End keys in the workspace tab strip', async () => {
  const hosts = page.getByRole('tab', { name: 'Hosts', exact: true });
  const workspace = page.getByRole('tab', { name: 'Workspace', exact: true });
  const settings = page.getByRole('tab', { name: 'Settings', exact: true });

  await hosts.focus();
  await hosts.press('ArrowRight');
  await expect(workspace).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-selected', 'true');
  await workspace.press('End');
  await expect(settings).toBeFocused();
  await settings.press('ArrowRight');
  await expect(hosts).toBeFocused();
  await hosts.press('ArrowLeft');
  await expect(settings).toBeFocused();
  await settings.press('Home');
  await expect(hosts).toBeFocused();
});

test('keeps navigation and search usable at the minimum desktop window size', async () => {
  await page.setViewportSize({ width: 760, height: 520 });
  await expect(page.getByRole('searchbox', { name: 'Search hosts' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath('hosts-minimum.png') });
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hosts', exact: true })).toBeVisible();
});

test('saves appearance and rejects malformed preference IPC without changing saved values', async () => {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
  await page.getByLabel('Appearance', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  const rejected = await page.evaluate(async () => {
    try {
      await window.mterminal.savePreferences({ appearance: 'invalid' } as never);
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
});

test('keeps unsaved preferences on write failure and logs only a safe failure code', async () => {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
  const shell = page.getByLabel('Default shell executable', { exact: true });
  const shells = await page.evaluate(() => window.mterminal.getShells());
  const shellPath = shells[0]?.path;
  if (!shellPath) throw new Error('A shell is required for the preference write-failure test.');
  await shell.fill(shellPath);
  const blocked = join(userData, 'preferences.json');
  await mkdir(blocked);
  try {
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your changes are still in this form' }),
    ).toBeVisible();
    await expect(shell).toHaveValue(shellPath);
    const content = await readFile(join(userData, 'logs/diagnostics.log'), 'utf8');
    expect(content).toContain('preferences-save-failed');
    expect(content).not.toContain(shellPath);
  } finally {
    await rm(blocked, { recursive: true, force: true });
  }
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible();
});

test('starts a real local shell, preserves it across views, and closes the session', async () => {
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.keyboard.type('echo MTERMINAL_F07_READY');
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () =>
        ((await page.locator('.xterm-accessibility-tree').textContent()) ?? '').split(
          'MTERMINAL_F07_READY',
        ).length - 1,
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close session' })).toBeVisible();
  await page.getByRole('button', { name: 'Close session' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'No terminal tabs' })).toBeVisible();
});

test('rejects an unavailable shell override while preserving saved preferences', async () => {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  const invalid =
    info.platform === 'win32'
      ? 'C:\\__mterminal_missing_shell__\\missing.exe'
      : '/__mterminal_missing_shell__/missing';
  const field = page.getByLabel('Default shell executable', { exact: true });
  await field.fill(invalid);
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'The selected default shell is unavailable' }),
  ).toBeVisible();
  await expect(field).toHaveValue(invalid);
  const saved = await page.evaluate(() => window.mterminal.getPreferences());
  expect(saved.defaultShell).toBe('');
  await field.fill('');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible();
});

test('renders Unicode/ANSI output and keeps shell control keys out of native menus', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  test.skip(
    info.platform === 'win32',
    'Unix shell command fixture; Windows ConPTY needs its own phase compatibility check.',
  );
  const shells = await page.evaluate(() => window.mterminal.getShells());
  const bash = shells.find((shell) => shell.name === 'bash');
  test.skip(!bash, 'This keyboard fixture requires Bash/readline.');
  await page.evaluate(async (path) => {
    const preferences = await window.mterminal.getPreferences();
    await window.mterminal.savePreferences({ ...preferences, defaultShell: path! });
  }, bash?.path);
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  // The completed marker does not appear literally in the typed command.
  await page.keyboard.insertText(
    "printf '\\033[31mF09_\\x55\\x4e\\x49\\x43\\x4f\\x44\\x45\\033[0m %s\\n' 'বাংলা 中文 😀 é'",
  );
  await page.keyboard.press('Enter');
  const tree = page.locator('.xterm-accessibility-tree');
  await expect(tree).toContainText('F09_UNICODE বাংলা 中文 😀 é');
  await page.keyboard.type('echo discard');
  await page.keyboard.press('Control+w');
  await page.keyboard.type('F09_WORD');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await tree.textContent()) ?? '').split('F09_WORD').length - 1)
    .toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Control+r');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+u');
  await expect(page.getByRole('button', { name: 'Close session' })).toBeVisible();
  await page.keyboard.type('sleep 30');
  await page.keyboard.press('Enter');
  await expect(tree).toContainText('sleep 30');
  await page.keyboard.press('Control+c');
  await page.keyboard.type('echo F09_INTERRUPT');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await tree.textContent()) ?? '').split('F09_INTERRUPT').length - 1)
    .toBeGreaterThanOrEqual(2);
});

test('keeps the PTY grid equal to xterm after resizing and restoring a hidden workspace', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  test.skip(
    info.platform === 'win32',
    'This fixture uses Bash/stty; ConPTY still needs native verification.',
  );
  const shells = await page.evaluate(() => window.mterminal.getShells());
  const bash = shells.find((shell) => shell.name === 'bash');
  test.skip(!bash, 'This fixture requires Bash and stty.');
  await page.evaluate(async (path) => {
    const preferences = await window.mterminal.getPreferences();
    await window.mterminal.savePreferences({ ...preferences, defaultShell: path! });
  }, bash?.path);
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  async function checkSize(tag: string) {
    // DSR at the bottom-right reports xterm's grid; stty reports the PTY's grid.
    const command = `saved=$(stty -g); stty -echo -icanon min 1 time 0; printf '\\033[999;999H\\033[6n'; IFS= read -r -d R reply; stty "$saved"; reply=\${reply#$'\\e['}; set -- $(stty size); printf 'F10_${tag}:%sx%s:%s\\n' "$1" "$2" "$reply"`;
    await page.keyboard.insertText(command);
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-accessibility-tree')).toContainText(
      new RegExp(`F10_${tag}:(\\d+)x(\\d+):\\1;\\2`),
    );
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await checkSize('LARGE');
  await page.setViewportSize({ width: 760, height: 520 });
  await checkSize('SMALL');
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await checkSize('RESTORED');
});

test('creates independent tabs, renames, reorders, switches, and confirms closing', async () => {
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.keyboard.type('echo TAB_ONE_ONLY');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).toContainText('TAB_ONE_ONLY');
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Terminal 2', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).not.toContainText('TAB_ONE_ONLY');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Terminal name').fill('Build shell');
  await page.keyboard.press('Control+Alt+1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Workspace', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Move left', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Terminal sessions' });
  await expect(tabs.getByRole('tab').nth(0)).toHaveAttribute('aria-label', 'Build shell');
  await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-label', 'Terminal 1');
  await tabs.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).toContainText('TAB_ONE_ONLY');
  await page.getByRole('button', { name: 'Close Terminal 1', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toContainText('Close “Terminal 1”?');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close Terminal 1', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: 'Build shell' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('supports terminal tab keyboard navigation, rename, and reorder', async () => {
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Terminal sessions' });
  const two = tabs.getByRole('tab', { name: 'Terminal 2', exact: true });
  await two.focus();
  await two.press('ArrowLeft');
  const one = tabs.getByRole('tab', { name: 'Terminal 1', exact: true });
  await expect(one).toBeFocused();
  await one.press('F2');
  await page.getByRole('dialog').getByLabel('Terminal name').fill('Keyboard shell');
  await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
  const renamed = tabs.getByRole('tab', { name: 'Keyboard shell', exact: true });
  await expect(renamed).toBeFocused();
  await renamed.press('Alt+Shift+ArrowRight');
  await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-label', 'Keyboard shell');
  const workspaceView = page.getByRole('tab', { name: 'Workspace', exact: true });
  await workspaceView.focus();
  await workspaceView.press('ArrowLeft');
  const hostsView = page.getByRole('tab', { name: 'Hosts', exact: true });
  await expect(hostsView).toBeFocused();
  await hostsView.press('ArrowRight');
  await expect(workspaceView).toBeFocused();
});

test('copies selection and confirms/cancels multiline paste without touching the real OS clipboard', async () => {
  // Replace clipboard IO only inside this isolated Electron test process.
  await application.evaluate(({ clipboard }) => {
    clipboard.readText = async () => 'echo CLIP_SINGLE';
    clipboard.writeText = async (text) => {
      Reflect.set(globalThis, '__copiedFixtureText', text);
    };
  });
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy selection', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Text pasted.' })).toBeVisible();
  const textarea = page.locator('.terminal-pane:not([hidden]) textarea');
  await textarea.press('Enter');
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).toContainText('CLIP_SINGLE');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Copy selection', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Selection copied.' })).toBeVisible();
  const copied = await application.evaluate(
    () => Reflect.get(globalThis, '__copiedFixtureText') as string,
  );
  expect(copied).toContain('CLIP_SINGLE');
  await application.evaluate(({ clipboard }) => {
    clipboard.readText = async () => 'echo MULTI_ONE\necho MULTI_TWO\n';
  });
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Paste into “Terminal 1”?' });
  await expect(preview.getByLabel('Paste preview')).toContainText('echo MULTI_ONE');
  const tree = page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree');
  await expect(tree).not.toContainText('MULTI_ONE');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tree).not.toContainText('MULTI_ONE');
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Paste into terminal', exact: true })
    .click();
  await textarea.press('Enter');
  await expect(tree).toContainText('MULTI_TWO');
});

test('intercepts native paste events and refuses a confirmed paste into an exited session', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  test.skip(
    info.platform === 'win32',
    'The exit fixture is verified with a Unix shell at the phase gate.',
  );
  await application.evaluate(({ ipcMain }) => {
    ipcMain.on('terminal:ack', (_event, id: string) => {
      Reflect.set(globalThis, '__fixtureSession', id);
    });
  });
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.locator('.terminal-pane:not([hidden]) textarea').evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'echo STALE_PASTE\n');
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect
    .poll(() => application.evaluate(() => Reflect.get(globalThis, '__fixtureSession')))
    .toBeTruthy();
  const sessionId = await application.evaluate(
    () => Reflect.get(globalThis, '__fixtureSession') as string,
  );
  expect(sessionId).toBeTruthy();
  await page.evaluate(
    (id) => window.mterminal.writeTerminal(id, { kind: 'text', data: 'exit\r' }),
    sessionId,
  );
  await expect(page.getByRole('status').filter({ hasText: 'Shell exited' })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Paste into terminal', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Paste cancelled: the target session is no longer active.' }),
  ).toBeVisible();
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).not.toContainText('STALE_PASTE');
});

test('searches retained terminal output and keeps searches isolated by tab', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  test.skip(info.platform === 'win32', 'This fixture uses a Unix shell.');
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.keyboard.type('echo SEARCH_F13_MARKER');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).toContainText('SEARCH_F13_MARKER');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('search', { name: 'Search Terminal 1' });
  await search.getByLabel('Find output').fill('SEARCH_F13_MARKER');
  await expect(search.getByRole('status')).not.toHaveText('No matches');
  await search.getByRole('button', { name: 'Next match' }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const second = page.getByRole('search', { name: 'Search Terminal 2' });
  await second.getByLabel('Find output').fill('SEARCH_F13_MARKER');
  await expect(second.getByRole('status')).toHaveText('No matches');
  await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
  await expect(search.getByLabel('Find output')).toHaveValue('SEARCH_F13_MARKER');
});

test('keeps terminal appearance settings independent between tabs', async () => {
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const first = page.getByRole('tabpanel', { name: 'Terminal 1' });
  await first.getByText('Terminal appearance').click();
  await first.getByLabel('Theme', { exact: true }).selectOption('light');
  await first.getByLabel('Font size').selectOption('20');
  await first.getByLabel('Zoom', { exact: true }).selectOption('125');
  await first.getByLabel('Cursor', { exact: true }).selectOption('bar');
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const second = page.getByRole('tabpanel', { name: 'Terminal 2' });
  await second.getByText('Terminal appearance').click();
  await expect(second.getByLabel('Theme', { exact: true })).toHaveValue('system');
  await expect(second.getByLabel('Font size')).toHaveValue('14');
  await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
  await expect(first.getByLabel('Theme', { exact: true })).toHaveValue('light');
  await expect(first.getByLabel('Font size')).toHaveValue('20');
  await first.getByRole('button', { name: 'Reset appearance' }).click();
  await expect(first.getByLabel('Cursor', { exact: true })).toHaveValue('block');
});

test('cancelling window close preserves an active terminal', async () => {
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await application.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
});

test('closing a terminal hangs up its foreground job on Unix', async () => {
  test.skip(process.platform === 'win32', 'Unix shell and hangup semantics only');
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const pidFile = join(userData, 'foreground.pid');
  const quotedFile = `'${pidFile.replaceAll("'", "'\\''")}'`;
  await page.keyboard.type(`sh -c 'echo $$ > "$1"; exec sleep 60' sh ${quotedFile}`);
  await page.keyboard.press('Enter');
  let childPid = 0;
  await expect
    .poll(async () => {
      try {
        childPid = Number(await readFile(pidFile, 'utf8'));
        return childPid > 1;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Close session' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect
    .poll(() => {
      try {
        process.kill(childPid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    })
    .toBe(false);
});

test('renders a sustained output burst and remains usable', async () => {
  test.skip(process.platform === 'win32', 'Unix awk workload');
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.keyboard.type(
    "awk 'BEGIN { for (i=0; i<30000; i++) print i, \"terminal output workload\" }'; printf '\\nF16_%s\\n' DONE",
  );
  await page.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.xterm-accessibility-tree').textContent()) ?? '', {
      timeout: 30000,
    })
    .toContain('F16_DONE');
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
});

test('persists, searches, edits and confirms deletion of saved hosts', async () => {
  await page.getByRole('button', { name: 'New host', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill('Build server');
  await form.getByLabel('Address').fill('build.example.com');
  await form.getByLabel('Username').fill('deploy');
  await form.getByRole('button', { name: 'Save host' }).click();
  await expect(page.getByText('Build server', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Build server', { exact: true })).toBeVisible();
  await page.getByLabel('Search hosts').fill('missing');
  await expect(page.getByRole('heading', { name: 'No matching hosts' })).toBeVisible();
  await page.getByLabel('Clear host search').click();
  await page.getByRole('button', { name: 'Edit Build server' }).click();
  await form.getByLabel('Port').fill('2222');
  await form.getByRole('button', { name: 'Save host' }).click();
  await expect(page.getByText('deploy@build.example.com:2222 · SSH')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Build server' }).click();
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Build server', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Build server' }).click();
  await form.getByRole('button', { name: 'Delete host', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your connections start here' })).toBeVisible();
});

test('rejects malformed host writes without changing saved profiles', async () => {
  const result = await page.evaluate(async () => {
    const before = await window.mterminal.listHosts();
    let rejected = false;
    try {
      await window.mterminal.saveHost({
        name: 'Invalid',
        address: 'example.com',
        port: 0,
        username: '',
        protocol: 'ssh',
      });
    } catch {
      rejected = true;
    }
    return {
      rejected,
      unchanged: JSON.stringify(before) === JSON.stringify(await window.mterminal.listHosts()),
    };
  });
  expect(result).toEqual({ rejected: true, unchanged: true });
});

test('organizes hosts with nested groups, tags and inherited defaults', async () => {
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Group path').fill('Work');
  await page.getByRole('dialog').getByLabel('Default port').fill('2222');
  await page.getByRole('dialog').getByLabel('Default username').fill('ops');
  await page.getByRole('dialog').getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.evaluate(async () => {
    await window.mterminal.saveHostGroup({ path: 'Work/Production', port: null, username: null });
    await window.mterminal.saveHost({
      name: 'Production',
      address: 'prod.example.com',
      port: 22,
      username: '',
      protocol: 'ssh',
      groupPath: 'Work/Production',
      tags: ['prod'],
      inheritPort: true,
      inheritUsername: true,
    });
  });
  await page.reload();
  await expect(page.getByText('ops@prod.example.com:2222 · SSH')).toBeVisible();
  await page.getByLabel('Group', { exact: true }).selectOption('Work');
  await page.getByLabel('Tag', { exact: true }).selectOption('prod');
  await expect(page.getByText('Production', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect((await page.evaluate(() => window.mterminal.listHostGroups())).length).toBe(2);
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete group', exact: true }).click();
  await expect(page.getByText('Ungrouped · prod')).toBeVisible();
  await expect(page.getByText('ops@prod.example.com:2222 · SSH')).toBeVisible();
});

test('opens an SSH credential prompt and cancels without starting a session', async () => {
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'SSH target',
      address: '127.0.0.1',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connect to SSH target', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await expect(dialog.getByLabel('Session password')).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No active session' })).toBeVisible();
});

test('uses an assigned reusable SSH identity for the connection prompt', async () => {
  await page.evaluate(async () => {
    const identity = await window.mterminal.saveSshIdentity({
      name: 'Deployment',
      username: 'deploy',
      method: 'privateKey',
    });
    await window.mterminal.saveHostGroup({
      path: 'IdentityGroup',
      port: null,
      username: null,
      identityId: identity.id,
    });
    await window.mterminal.saveHost({
      name: 'Identity target',
      address: '127.0.0.1',
      port: 22,
      username: '',
      protocol: 'ssh',
      groupPath: 'IdentityGroup',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connect to Identity target', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await expect(dialog.getByLabel('Authentication method')).toHaveValue('privateKey');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('offers session-only private-key and keyboard-interactive authentication', async () => {
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'Authentication fixture',
      address: '127.0.0.1',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connect to Authentication fixture' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Authentication method').selectOption('privateKey');
  await expect(dialog.getByLabel('Session password')).toHaveCount(0);
  await dialog.getByLabel('Private key file').setInputFiles({
    name: 'synthetic-key',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic fixture; not a real key'),
  });
  await dialog.getByLabel('Key passphrase (if encrypted)').fill('fixture passphrase');
  await expect(dialog.getByLabel('Key passphrase (if encrypted)')).toHaveAttribute(
    'type',
    'password',
  );
  await dialog.getByLabel('Authentication method').selectOption('keyboard-interactive');
  await expect(dialog.getByLabel('Private key file')).toHaveCount(0);
  await expect(dialog.getByLabel('Key passphrase (if encrypted)')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const profiles = await page.evaluate(() => window.mterminal.listHosts());
  expect(profiles[0]).not.toHaveProperty('privateKey');
  expect(profiles[0]).not.toHaveProperty('passphrase');
});

for (const changed of [false, true]) {
  test(`shows ${changed ? 'changed' : 'unknown'} server identity before accepting trust`, async () => {
    // Exercise the trust dialog through an isolated IPC fixture; no network connection is made.
    await application.evaluate(({ ipcMain }, changed) => {
      ipcMain.removeHandler('terminal:ssh');
      ipcMain.handle(
        'terminal:ssh',
        (event, id: string) =>
          new Promise((resolve) => {
            const token = '12345678-1234-4123-8123-123456789abc';
            const fingerprint = 'SHA256:' + 'b'.repeat(43);
            ipcMain.once('terminal:ssh-answer', (_reply, replyId, replyToken, answers) => {
              const correct =
                replyId === id &&
                replyToken === token &&
                answers[0] === (changed ? fingerprint : 'trust');
              event.sender.send('terminal:event', { kind: 'exit', id, exitCode: correct ? 0 : 1 });
              resolve({ ok: true });
            });
            event.sender.send('terminal:ssh-challenge', {
              id,
              token,
              title: 'Server identity',
              instructions: '',
              prompts: [{ prompt: 'Trust decision', echo: true }],
              trust: {
                address: 'example.com',
                port: 22,
                fingerprint,
                ...(changed ? { previous: 'SHA256:' + 'a'.repeat(43) } : {}),
              },
            });
          }),
      );
    }, changed);
    await page.evaluate(async () => {
      await window.mterminal.saveHost({
        name: 'Trust fixture',
        address: 'example.com',
        port: 22,
        username: 'deploy',
        protocol: 'ssh',
      });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Connect to Trust fixture' }).click();
    await expect(page.getByRole('dialog').getByLabel('SSH username')).toHaveValue('deploy');
    await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toContainText(
      changed ? 'Server key changed' : 'Unknown server key',
    );
    if (changed) {
      const replace = dialog.getByRole('button', {
        name: 'Replace saved key and cancel connection',
      });
      await expect(replace).toBeDisabled();
      await dialog.getByLabel('Type the verified new fingerprint').fill('SHA256:' + 'b'.repeat(43));
      await replace.click();
    } else await dialog.getByRole('button', { name: 'Trust and save key' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'SSH disconnected (code 0)' }),
    ).toBeVisible();
  });
}

for (const outcome of ['disconnected', 'failed'] as const) {
  test(`shows SSH progress and preserves output when ${outcome}`, async () => {
    // Control IPC progress without using the network or weakening host-key verification.
    await application.evaluate(({ ipcMain }, outcome) => {
      ipcMain.removeHandler('terminal:ssh');
      ipcMain.handle(
        'terminal:ssh',
        (event, id: string) =>
          new Promise((resolve) => {
            event.sender.send('terminal:event', { kind: 'state', id, state: 'connecting' });
            ipcMain.on('fixture:ssh-step', (_event, state: string) => {
              if (state === 'end') {
                event.sender.send('terminal:event', {
                  kind: 'data',
                  id,
                  data: 'F22_FINAL_OUTPUT\r\n',
                });
                event.sender.send('terminal:event', {
                  kind: 'exit',
                  id,
                  exitCode: outcome === 'failed' ? 255 : 0,
                  connectionState: outcome,
                });
              } else {
                event.sender.send('terminal:event', { kind: 'state', id, state });
                if (state === 'connected') resolve({ ok: true });
              }
            });
          }),
      );
    }, outcome);
    await page.evaluate(async () => {
      await window.mterminal.saveHost({
        name: 'State fixture',
        address: 'example.com',
        port: 22,
        username: 'deploy',
        protocol: 'ssh',
      });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Connect to State fixture' }).click();
    await expect(page.getByRole('dialog').getByLabel('SSH username')).toHaveValue('deploy');
    await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'SSH connecting…' })).toBeVisible();
    for (const [state, message] of [
      ['verifying', 'SSH verifying server identity…'],
      ['authenticating', 'SSH authenticating…'],
      ['opening-shell', 'SSH opening remote shell…'],
      ['connected', 'SSH connected'],
    ] as const) {
      await application.evaluate(({ ipcMain }, state) => {
        ipcMain.emit('fixture:ssh-step', null, state);
      }, state);
      await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
      if (state === 'authenticating') {
        await page.getByRole('tab', { name: 'State fixture', exact: true }).press('Delete');
        await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(
          'Close “State fixture”?',
        );
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    }
    await application.evaluate(({ ipcMain }) => {
      ipcMain.emit('fixture:ssh-step', null, 'end');
    });
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `SSH ${outcome} (code ${outcome === 'failed' ? 255 : 0})` }),
    ).toBeVisible();
    await expect
      .poll(async () => (await page.locator('.xterm-accessibility-tree').textContent()) ?? '')
      .toContain('F22_FINAL_OUTPUT');
    await expect(page.getByRole('button', { name: 'Paste', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reconnect SSH', exact: true })).toBeVisible();
  });
}

test('marks a rejected SSH startup as failed rather than disconnected', async () => {
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', () => ({ ok: false, code: 'ssh-failed' }));
  });
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'Failed startup',
      address: 'example.com',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connect to Failed startup' }).click();
  await expect(page.getByRole('dialog').getByLabel('SSH username')).toHaveValue('deploy');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH failed.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect SSH', exact: true })).toBeVisible();
});

test('reconnect asks for fresh credentials, preserves output on cancel and never replays input', async () => {
  // Isolated IPC fixture: verify reconnect behavior without contacting a server.
  await application.evaluate(({ ipcMain }) => {
    const attempts: string[] = [];
    const writes: { id: string; data: string }[] = [];
    const supplied: boolean[] = [];
    let drop: () => void = () => {};
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', (event, id: string, _size, _host, credentials) => {
      attempts.push(id);
      supplied.push(credentials.password === `fixture-${attempts.length}`);
      event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
      event.sender.send('terminal:event', {
        kind: 'data',
        id,
        data: `F23_OUTPUT_${attempts.length}\r\n`,
      });
      drop = () =>
        event.sender.send('terminal:event', {
          kind: 'exit',
          id,
          exitCode: 255,
          connectionState: 'failed',
          failureCode: 'ssh-keepalive-timeout',
        });
      return { ok: true };
    });
    ipcMain.on('terminal:write', (_event, id, input) => writes.push({ id, data: input.data }));
    ipcMain.on('fixture:drop', () => drop());
    ipcMain.on(
      'fixture:inspect',
      (
        _event,
        reply: (value: {
          attempts: string[];
          writes: { id: string; data: string }[];
          supplied: boolean[];
        }) => void,
      ) => reply({ attempts, writes, supplied }),
    );
  });
  const inspect = () =>
    application.evaluate(
      ({ ipcMain }) =>
        new Promise<{
          attempts: string[];
          writes: { id: string; data: string }[];
          supplied: boolean[];
        }>((resolve) => {
          ipcMain.emit('fixture:inspect', null, resolve);
        }),
    );
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'Reconnect fixture',
      address: 'example.com',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connect to Reconnect fixture' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await dialog.getByLabel('Session password').fill('fixture-1');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo DO_NOT_REPLAY');
  await expect
    .poll(async () => (await inspect()).writes.map((write) => write.data).join(''))
    .toContain('echo DO_NOT_REPLAY');
  await application.evaluate(({ ipcMain }) => {
    ipcMain.emit('fixture:drop');
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'stopped responding to keepalive' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect SSH' }).click();
  await expect(dialog.getByLabel('Session password')).toHaveValue('');
  await expect(dialog).toContainText('previous session is lost');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.xterm-accessibility-tree').textContent()) ?? '')
    .toContain('F23_OUTPUT_1');
  expect((await inspect()).attempts).toHaveLength(1);
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  expect((await inspect()).attempts).toHaveLength(1);
  await page.getByRole('button', { name: 'Reconnect SSH' }).click();
  await expect(dialog.getByLabel('Session password')).toHaveValue('');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await dialog.getByLabel('Session password').fill('fixture-2');
  await dialog.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
  const result = await inspect();
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[0]).not.toBe(result.attempts[1]);
  expect(result.writes.filter((write) => write.id === result.attempts[1])).toEqual([]);
  expect(result.supplied).toEqual([true, true]);
});

test('cancels a pending SSH attempt in place and ignores its late events and reply', async () => {
  // Keep a fixture request pending until cancellation, then deliver deliberately stale callbacks.
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle(
      'terminal:ssh',
      (event, id: string) =>
        new Promise((resolve) => {
          event.sender.send('terminal:event', { kind: 'state', id, state: 'authenticating' });
          ipcMain.once('terminal:close', (_reply, closedId) => {
            if (closedId !== id) return;
            event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
            event.sender.send('terminal:event', { kind: 'data', id, data: 'F24_STALE_OUTPUT' });
            resolve({ ok: true });
          });
        }),
    );
  });
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'Cancel fixture',
      address: 'example.com',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connect to Cancel fixture' }).click();
  await expect(page.getByRole('dialog').getByLabel('SSH username')).toHaveValue('deploy');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH authenticating…' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'SSH connection cancelled.' }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cancel fixture', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect SSH' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.xterm-accessibility-tree')).not.toContainText('F24_STALE_OUTPUT');
});
