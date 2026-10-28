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
    await application?.close();
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
  await shell.fill('/private/test-shell');
  const blocked = join(userData, 'preferences.json');
  await mkdir(blocked);
  try {
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your changes are still in this form' }),
    ).toBeVisible();
    await expect(shell).toHaveValue('/private/test-shell');
    const content = await readFile(join(userData, 'logs/diagnostics.log'), 'utf8');
    expect(content).toContain('preferences-save-failed');
    expect(content).not.toContain('/private/test-shell');
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
  await expect(page.getByRole('status').filter({ hasText: 'Session closed' })).toBeVisible();
});
