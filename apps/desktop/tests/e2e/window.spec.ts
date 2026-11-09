import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { TransferRecoveryRecord } from '../../src/shared/transfers.js';
import type { RemoteEditState } from '../../src/shared/remote-edit.js';

const desktopDirectory = fileURLToPath(new URL('../../', import.meta.url));
const electronExecutable = createRequire(import.meta.url)('electron') as string;
let application: ElectronApplication;
let page: Page;
let userData: string;

/** Opens the visible terminal's action menu and returns it. */
async function openTerminalMenu() {
  await page
    .locator('.terminal-pane[data-active="true"]:not([hidden])')
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  return page.getByRole('menu');
}

/** Chooses an item from the visible terminal's action menu. */
async function terminalAction(name: string) {
  const menu = await openTerminalMenu();
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

/** Chooses an item from a session tab's right-click menu. */
async function tabAction(tab: string, name: string) {
  await page.getByRole('tab', { name: tab, exact: true }).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}

/** Chooses an item from a host card's action menu. */
async function hostAction(host: string, name: string) {
  await page.getByRole('button', { name: `More actions for ${host}`, exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}

/** Sidebar button for a main view (Hosts, Workspace, Settings). */
function navButton(name: string) {
  return page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true });
}

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
    // Keep test shells out of the developer's real Bash history.
    env: { ...env, MTERMINAL_USER_DATA: userData, HISTFILE: join(userData, 'bash_history') },
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
    methods: Object.keys(window.mterminal).sort(),
    nodeProcess: typeof Reflect.get(window, 'process'),
    nodeRequire: typeof Reflect.get(window, 'require'),
  }));
  expect(exposed).toEqual({
    methods: [
      'ackTerminal',
      'answerSshChallenge',
      'cancelTransfer',
      'cleanupTransferPartial',
      'clearFinishedTransfers',
      'clearHistory',
      'closeTerminal',
      'deleteHistory',
      'deleteHost',
      'deleteHostGroup',
      'deleteSnippet',
      'deleteSshIdentity',
      'deleteSshKey',
      'deleteSshPassword',
      'deleteWorkspaceTemplate',
      'enqueueTransfer',
      'exportWorkspace',
      'finishRemoteEdit',
      'forgetTransferRecovery',
      'generateSshKey',
      'getAppInfo',
      'getPreferences',
      'getRemoteEdit',
      'getShells',
      'getSshKeyStatus',
      'getSshPasswordStatus',
      'getStartupSnippet',
      'getVaultState',
      'importSshKey',
      'importWorkspace',
      'inspectTransferPartial',
      'inspectTransferResume',
      'installSshPublicKey',
      'listDirectory',
      'listHostGroups',
      'listHosts',
      'listSnippets',
      'listSshIdentities',
      'listTransferRecovery',
      'listTransfers',
      'listWorkspaceTemplates',
      'lockVault',
      'mutateDirectory',
      'onHistoryChanged',
      'onRemoteEditChanged',
      'onSnippetsChanged',
      'onSshChallenge',
      'onTerminalEvent',
      'onTransfersChanged',
      'onVaultLocked',
      'openSshTerminal',
      'openTerminal',
      'readClipboardText',
      'reopenRemoteEdit',
      'resetVault',
      'resizeTerminal',
      'resolveTransferConflict',
      'resumeTransfer',
      'saveHost',
      'saveHostGroup',
      'savePreferences',
      'saveSnippet',
      'saveSshIdentity',
      'saveSshLogin',
      'saveSshPassword',
      'saveWorkspaceTemplate',
      'searchHistory',
      'setStartupSnippet',
      'setupVault',
      'startRemoteEdit',
      'unlockVault',
      'uploadRemoteEdit',
      'writeClipboardText',
      'writeTerminal',
    ],
    nodeProcess: 'undefined',
    nodeRequire: 'undefined',
  });
});

test('browses local files, toggles hidden entries and reports folder errors', async () => {
  const folder = join(userData, 'file-browser-fixture');
  await mkdir(join(folder, 'child'), { recursive: true });
  await writeFile(join(folder, '.hidden'), 'hidden');
  await writeFile(join(folder, 'visible.txt'), 'content');
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'Start local shell', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const local = page.getByRole('region', { name: 'Local files', exact: true });
  await local.getByRole('button', { name: 'local edit location', exact: true }).click();
  await local.getByLabel('local folder path').fill(folder);
  await local.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(local.getByText('visible.txt', { exact: true })).toBeVisible();
  await expect(local.getByText('.hidden', { exact: true })).toBeHidden();
  await local.getByRole('button', { name: 'local Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show hidden files', exact: true }).click();
  await expect(local.getByText('.hidden', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: 'local filter files', exact: true }).click();
  await local.getByLabel('local filename filter').fill('VISIBLE');
  await expect(local.getByRole('button', { name: 'visible.txt', exact: true })).toBeVisible();
  await expect(local.getByRole('button', { name: '.hidden', exact: true })).toBeHidden();
  await local.getByRole('button', { name: 'visible.txt', exact: true }).click();
  await expect(local.getByRole('button', { name: 'visible.txt', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    local.getByRole('button', { name: 'Upload visible.txt', exact: true }),
  ).toBeDisabled();
  await local.getByLabel('local filename filter').fill('no-matching-file');
  await expect(local.getByText('No files match this filter.', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: 'local close filter', exact: true }).click();
  await local.getByRole('button', { name: 'Date Modified', exact: true }).click();
  await expect(
    local.getByRole('columnheader', { name: 'Date Modified', exact: true }),
  ).toHaveAttribute('aria-sort', 'ascending');
  await local.getByRole('button', { name: 'Date Modified', exact: true }).click();
  await expect(
    local.getByRole('columnheader', { name: 'Date Modified', exact: true }),
  ).toHaveAttribute('aria-sort', 'descending');
  await local.getByRole('button', { name: 'child', exact: true }).dblclick();
  await expect(local.getByText('This folder is empty.')).toBeVisible();
  await local.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(local.getByText('visible.txt', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: 'Forward', exact: true }).click();
  await expect(local.getByText('This folder is empty.')).toBeVisible();
  await local.getByRole('button', { name: 'Up', exact: true }).click();
  await expect(local.getByText('visible.txt', { exact: true })).toBeVisible();
  const childRow = local
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'child', exact: true }) });
  await childRow.focus();
  await page.keyboard.press('ArrowDown');
  await expect(local.locator('tbody tr.file-row-selected')).toHaveCount(1);
  await expect(local.getByRole('button', { name: 'child', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await childRow.focus();
  await page.keyboard.press('Enter');
  await expect(local.getByText('This folder is empty.')).toBeVisible();
  await local.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(local.getByText('visible.txt', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: 'local edit location', exact: true }).click();
  await local.getByLabel('local folder path').fill(join(folder, 'absent'));
  await local.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(local.getByRole('alert')).toContainText('no longer exists');
  await expect(local.getByText('visible.txt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to terminal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'File browser', exact: true })).toBeHidden();
});

test('creates, renames and confirms deletion of a local folder without overwriting collisions', async () => {
  const folder = join(userData, 'file-operation-fixture');
  await mkdir(folder);
  await writeFile(join(folder, 'existing'), 'keep');
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'Start local shell', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const local = page.getByRole('region', { name: 'Local files', exact: true });
  await local.getByRole('button', { name: 'local edit location', exact: true }).click();
  await local.getByLabel('local folder path').fill(folder);
  await local.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(local.getByText('existing', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: 'local Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Folder name', { exact: true }).fill('new-folder');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(local.getByRole('button', { name: 'Actions for new-folder' })).toBeEnabled();
  await local.getByRole('button', { name: 'Actions for new-folder' }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('New name', { exact: true }).fill('existing');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(local.getByRole('status').filter({ hasText: 'already exists' })).toBeVisible();
  expect(await readFile(join(folder, 'existing'), 'utf8')).toBe('keep');
  await expect(local.getByRole('button', { name: 'Actions for new-folder' })).toBeEnabled();
  await local.getByRole('button', { name: 'Actions for new-folder' }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  await page.getByRole('dialog').getByLabel('New name', { exact: true }).fill('renamed-folder');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(local.getByRole('button', { name: 'Actions for renamed-folder' })).toBeEnabled();
  await local.getByRole('button', { name: 'Actions for renamed-folder' }).click();
  await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('renamed-folder');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(local.getByRole('button', { name: 'Actions for renamed-folder' })).toBeEnabled();
  await local.getByRole('button', { name: 'Actions for renamed-folder' }).click();
  await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await expect(local.getByRole('button', { name: 'Actions for renamed-folder' })).toBeHidden();
  expect(await readFile(join(folder, 'existing'), 'utf8')).toBe('keep');
});

test('shows saved recovery evidence and confirms forgetting only the record', async () => {
  await application.evaluate(({ ipcMain, BrowserWindow }) => {
    let records = [
      {
        id: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
        sessionId: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
        title: 'Recovery fixture',
        direction: 'upload',
        name: 'recover.txt',
        localDirectory: '/local',
        remoteDirectory: '/remote',
        state: 'running',
        phase: 'publishing',
        partialPath: '/remote/possible.part',
        backupPath: '/remote/possible.bak',
        source: null,
        destination: null,
        peer: null,
        updatedAt: '2026-11-09T00:00:00.000Z',
      },
    ];
    ipcMain.removeHandler('transfers:recovery');
    ipcMain.handle('transfers:recovery', () => ({ ok: true, value: records }));
    ipcMain.removeHandler('transfers:forget');
    ipcMain.handle('transfers:forget', (_event, id: string) => {
      records = records.filter((record) => record.id !== id);
      BrowserWindow.getAllWindows()[0]!.webContents.send('transfers:changed');
      return { ok: true, value: undefined };
    });
  });
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Saved transfer recovery' });
  await recovery.getByRole('button', { name: 'Show recovery records', exact: true }).click();
  await expect(recovery).toContainText('Interrupted · publishing');
  await expect(recovery).toContainText('/remote/possible.bak');
  await recovery.getByRole('button', { name: 'Forget recovery record for recover.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Forget recovery record?' });
  await expect(dialog).toContainText('stay on disk');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Forget recovery record for recover.txt' }).click();
  await dialog.getByRole('button', { name: 'Forget record', exact: true }).click();
  await expect(recovery).toHaveCount(0);
});

test('previews recovery cleanup and resume with explicit Cancel-first confirmations', async () => {
  await application.evaluate(({ ipcMain, BrowserWindow }) => {
    const id = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
    const peer = {
      address: 'example.com',
      port: 22,
      username: 'deploy',
      fingerprint: `SHA256:${'a'.repeat(43)}`,
    };
    const file = {
      path: `/remote/.mterminal-${id}.part`,
      kind: 'file' as const,
      size: 3,
      modified: 1,
      permissions: '0600',
      version: 'partial',
    };
    let records: TransferRecoveryRecord[] = [
      {
        id,
        sessionId: id,
        title: 'Cleanup fixture',
        name: 'recover.txt',
        direction: 'upload',
        localDirectory: '/local',
        remoteDirectory: '/remote',
        state: 'failed',
        phase: 'staging',
        partialPath: file.path as string | null,
        backupPath: '/remote/retained.bak',
        source: null,
        destination: null,
        staging: { ...file, size: 0 },
        peer,
        updatedAt: '2026-11-09T00:00:00.000Z',
      },
    ];
    const resumeId = '14e9f162-d3cd-4c8f-a70a-2323a1751a9b';
    const resumeFile = { ...file, path: `/remote/.mterminal-${resumeId}.part` };
    records.push({
      ...records[0]!,
      id: resumeId,
      name: 'continue.txt',
      partialPath: resumeFile.path,
      backupPath: null,
      staging: { ...resumeFile, size: 0 },
      source: { ...file, path: '/local/continue.txt', size: 10 },
      destination: { ...file, path: '/remote/continue.txt', size: 2 },
    });
    ipcMain.removeHandler('transfers:inspect-resume');
    ipcMain.handle('transfers:inspect-resume', () => ({
      ok: true,
      value: {
        file: resumeFile,
        digest: 'hash',
        token: resumeId,
        recordId: resumeId,
        side: 'remote',
        peer,
        destination: records.find((record) => record.id === resumeId)!.destination,
        total: 10,
        remaining: 7,
      },
    }));
    ipcMain.removeHandler('transfers:resume');
    ipcMain.handle('transfers:resume', () => {
      records = records.filter((record) => record.id !== resumeId);
      BrowserWindow.getAllWindows()[0]!.webContents.send('transfers:changed');
      return { ok: true, value: undefined };
    });
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', (event, id: string) => {
      event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
      return { ok: true };
    });
    ipcMain.removeHandler('transfers:recovery');
    ipcMain.handle('transfers:recovery', () => ({ ok: true, value: records }));
    ipcMain.removeHandler('transfers:inspect-partial');
    ipcMain.handle('transfers:inspect-partial', () => ({
      ok: true,
      value: { file, digest: 'hash', token: id, recordId: id, side: 'remote', peer },
    }));
    ipcMain.removeHandler('transfers:cleanup-partial');
    ipcMain.handle('transfers:cleanup-partial', () => {
      records = records.map((record) => ({ ...record, partialPath: null }));
      BrowserWindow.getAllWindows()[0]!.webContents.send('transfers:changed');
      return { ok: true, value: undefined };
    });
  });
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'Cleanup fixture',
      address: 'example.com',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Cleanup fixture', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill('fixture');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Saved transfer recovery' });
  await recovery.getByRole('button', { name: 'Show recovery records', exact: true }).click();
  const inspect = recovery.getByRole('button', { name: 'Inspect temporary file for recover.txt' });
  await inspect.click();
  const dialog = page.getByRole('dialog', { name: 'Delete verified temporary file?' });
  await expect(dialog).toContainText('deploy@example.com:22');
  await expect(dialog).toContainText('Destination files and backups are preserved.');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(inspect).toBeVisible();
  await inspect.click();
  await dialog.getByRole('button', { name: 'Delete temporary file', exact: true }).click();
  await expect(inspect).toHaveCount(0);
  await expect(recovery).toContainText('/remote/retained.bak');
  const resume = recovery.getByRole('button', { name: 'Preview resume for continue.txt' });
  await resume.click();
  const continuation = page.getByRole('dialog', { name: 'Resume verified transfer?' });
  await expect(continuation).toContainText('Remaining:');
  await expect(continuation).toContainText('/remote/continue.txt');
  await expect(continuation).toContainText('new backup');
  await expect(continuation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await continuation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(resume).toBeVisible();
  await resume.click();
  await continuation.getByRole('button', { name: 'Resume and replace', exact: true }).click();
  await expect(resume).toHaveCount(0);
  await expect(recovery).toContainText('/remote/retained.bak');
});

test('drags individual files between panes and queues only after confirmation', async () => {
  const localRoot = join(userData, 'local-files');
  await application.evaluate(({ ipcMain }, localRoot) => {
    const queued: unknown[] = [];
    ipcMain.on('fixture:drag-transfers', (_event, respond: (value: unknown[]) => void) =>
      respond(queued),
    );
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', (event, id: string) => {
      event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
      return { ok: true };
    });
    ipcMain.removeHandler('files:list');
    ipcMain.handle('files:list', (_event, request: { side: 'local' | 'remote'; path: string }) => {
      const path = request.path || (request.side === 'local' ? localRoot : '/remote-files');
      const name = request.side === 'local' ? 'upload.txt' : 'download.txt';
      return {
        ok: true,
        value: {
          path,
          parent: path,
          breadcrumbs: [{ name: path, path }],
          truncated: false,
          canChmod: false,
          entries: [
            {
              name,
              path: `${path}/${name}`,
              kind: 'file',
              size: 3,
              modified: 1,
              permissions: '0600',
            },
            {
              name: 'folder',
              path: `${path}/folder`,
              kind: 'directory',
              size: 0,
              modified: 1,
              permissions: '0700',
            },
          ],
        },
      };
    });
    ipcMain.removeHandler('transfers:enqueue');
    ipcMain.handle('transfers:enqueue', (_event, request: unknown) => {
      queued.push(request);
      return { ok: true, value: undefined };
    });
  }, localRoot);
  const queued = () =>
    application.evaluate(
      ({ ipcMain }) =>
        new Promise<unknown[]>((resolve) => {
          ipcMain.emit('fixture:drag-transfers', null, resolve);
        }),
    );
  await page.evaluate(async () => {
    await window.mterminal.saveHost({
      name: 'Drag fixture',
      address: 'example.com',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
  });
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Drag fixture', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill('fixture');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const local = page.getByRole('region', { name: 'Local files', exact: true });
  const remote = page.getByRole('region', { name: 'Remote files', exact: true });
  const upload = local
    .getByRole('row')
    .filter({ has: page.getByText('upload.txt', { exact: true }) });
  const download = remote
    .getByRole('row')
    .filter({ has: page.getByText('download.txt', { exact: true }) });
  await local.getByRole('button', { name: 'upload.txt', exact: true }).click();
  await remote.getByRole('button', { name: 'download.txt', exact: true }).click();
  await expect(local.getByRole('button', { name: 'Upload upload.txt', exact: true })).toBeEnabled();
  await expect(
    remote.getByRole('button', { name: 'Download download.txt', exact: true }),
  ).toBeEnabled();
  await expect(
    local
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'folder', exact: true }) }),
  ).toHaveAttribute('draggable', 'false');
  // Native drag data carries only an opaque token; a forged token cannot select a path.
  const data = await page.evaluateHandle(() => new DataTransfer());
  try {
    await upload.dispatchEvent('dragstart', { dataTransfer: data });
    await data.evaluate((value) => value.setData('application/x-mterminal-file', 'forged-token'));
    await remote.dispatchEvent('drop', { dataTransfer: data });
    await upload.dispatchEvent('dragend', { dataTransfer: data });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await queued()).toEqual([]);
  } finally {
    await data.dispose();
  }
  await upload.dragTo(local);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await upload.dragTo(remote);
  let dialog = page.getByRole('dialog', { name: 'Upload file?' });
  await expect(dialog).toContainText(localRoot);
  await expect(dialog).toContainText('/remote-files');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await queued()).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await queued()).toEqual([]);
  await upload.dragTo(remote);
  await page.getByRole('dialog').getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect.poll(async () => (await queued()).length).toBe(1);
  expect((await queued())[0]).toMatchObject({
    name: 'upload.txt',
    direction: 'upload',
    localDirectory: localRoot,
    remoteDirectory: '/remote-files',
  });
  await download.dragTo(local);
  dialog = page.getByRole('dialog', { name: 'Download file?' });
  await expect(dialog).toContainText('Remote → Local');
  await dialog.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect.poll(async () => (await queued()).length).toBe(2);
  expect((await queued())[1]).toMatchObject({
    name: 'download.txt',
    direction: 'download',
    localDirectory: localRoot,
    remoteDirectory: '/remote-files',
  });
  await local.getByRole('button', { name: 'Upload upload.txt', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Upload file?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await upload.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Upload…', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Close session', exact: true })).toHaveCount(0);
});

test('renders transfer progress and cancels and clears jobs through preload', async () => {
  await application.evaluate(({ ipcMain, BrowserWindow }, directory) => {
    let jobs = [
      {
        id: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
        sessionId: '14e9f162-d3cd-4c8f-a70a-2323a1751a9b',
        title: 'Transfer fixture',
        direction: 'upload',
        name: 'queued-file.txt',
        localDirectory: directory,
        remoteDirectory: '/fixture',
        state: 'running',
        transferred: 128,
        total: 256,
        error: null,
        partialPath: null,
      },
    ];
    const changed = () => BrowserWindow.getAllWindows()[0]!.webContents.send('transfers:changed');
    ipcMain.removeHandler('transfers:list');
    ipcMain.handle('transfers:list', () => ({ ok: true, value: jobs }));
    ipcMain.removeHandler('transfers:cancel');
    ipcMain.handle('transfers:cancel', (_event, id: string) => {
      jobs = jobs.map((job) => (job.id === id ? { ...job, state: 'cancelled' } : job));
      changed();
      return { ok: true, value: undefined };
    });
    ipcMain.removeHandler('transfers:clear');
    ipcMain.handle('transfers:clear', () => {
      jobs = [];
      changed();
      return { ok: true, value: undefined };
    });
  }, userData);
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'Start local shell', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Transfer queue', exact: true });
  await expect(queue.getByRole('progressbar')).toHaveAttribute('value', '128');
  await expect(queue).toContainText('Transfer fixture');
  await queue.getByRole('button', { name: 'Cancel upload queued-file.txt' }).click();
  await queue.getByRole('button', { name: 'Show transfer details', exact: true }).click();
  await expect(queue.getByRole('status')).toHaveText('cancelled');
  await queue.getByRole('button', { name: 'Clear finished' }).click();
  await expect(queue.getByRole('progressbar')).toBeHidden();
});

test('previews transfer conflicts with Skip as default and explicit Replace and Cancel', async () => {
  await application.evaluate(({ ipcMain, BrowserWindow }, directory) => {
    const token = '04e9f162-d3cd-4c8f-a70a-2323a1751a9b';
    let jobs = ['skip.txt', 'replace.txt', 'cancel.txt'].map((name, index) => ({
      id: `14e9f162-d3cd-4c8f-a70a-2323a1751a9${index}`,
      sessionId: token,
      title: 'Conflict fixture',
      direction: 'upload',
      name,
      localDirectory: directory,
      remoteDirectory: '/fixture',
      state: 'conflict',
      transferred: 0,
      total: null,
      error: 'exists',
      partialPath: null,
      backupPath: null as string | null,
      conflict: {
        token,
        replaceable: true,
        source: {
          path: `${directory}/${name}`,
          kind: 'file',
          size: 10,
          modified: 1700000000000,
          permissions: '0600',
          version: 'source',
        },
        destination: {
          path: `/fixture/${name}`,
          kind: 'file',
          size: 20,
          modified: 1700000000000,
          permissions: '0644',
          version: 'destination',
        },
      },
    }));
    const changed = () => BrowserWindow.getAllWindows()[0]!.webContents.send('transfers:changed');
    ipcMain.removeHandler('transfers:list');
    ipcMain.handle('transfers:list', () => ({ ok: true, value: jobs }));
    ipcMain.removeHandler('transfers:resolve');
    ipcMain.handle('transfers:resolve', (_event, id: string, received: string, choice: string) => {
      if (received !== token) return { ok: false, code: 'destination-changed' };
      jobs = jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              state: choice === 'skip' ? 'skipped' : 'completed',
              backupPath: choice === 'replace' ? '/fixture/recovery.bak' : null,
            }
          : job,
      );
      changed();
      return { ok: true, value: undefined };
    });
    ipcMain.removeHandler('transfers:cancel');
    ipcMain.handle('transfers:cancel', (_event, id: string) => {
      jobs = jobs.map((job) => (job.id === id ? { ...job, state: 'cancelled' } : job));
      changed();
      return { ok: true, value: undefined };
    });
  }, userData);
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'Start local shell', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Transfer queue', exact: true });
  await queue.getByRole('button', { name: 'Resolve conflict for skip.txt' }).click();
  let dialog = page.getByRole('dialog', { name: 'Destination already exists' });
  await expect(dialog.getByRole('region', { name: 'Existing destination' })).toContainText(
    '/fixture/skip.txt',
  );
  await expect(dialog.getByRole('button', { name: 'Skip', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    queue.getByRole('listitem').filter({ hasText: 'skip.txt' }).getByRole('status'),
  ).toHaveText('skipped');
  await queue.getByRole('button', { name: 'Resolve conflict for replace.txt' }).click();
  dialog = page.getByRole('dialog', { name: 'Destination already exists' });
  await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(queue).toContainText('/fixture/recovery.bak');
  await queue.getByRole('button', { name: 'Resolve conflict for cancel.txt' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel transfer', exact: true })
    .click();
  await queue.getByRole('button', { name: 'Show transfer details', exact: true }).click();
  await expect(
    queue.getByRole('listitem').filter({ hasText: 'cancel.txt' }).getByRole('status'),
  ).toHaveText('cancelled');
});

test('shows pending remote edits, uploads explicitly, and confirms local-only discard', async () => {
  await application.evaluate(({ ipcMain, BrowserWindow }, directory) => {
    let state: RemoteEditState | null = {
      id: '04e9f162-d3cd-4c8f-a70a-2323a1751a9b',
      sessionId: '14e9f162-d3cd-4c8f-a70a-2323a1751a9b',
      title: 'Remote editor fixture',
      remoteDirectory: '/remote',
      name: 'config.sh',
      localPath: `${directory}/private-edit/editing.txt`,
      workingDirectory: `${directory}/private-edit`,
      phase: 'ready',
      connected: true,
      hasCopy: true,
      changed: true,
      size: 20,
      error: null,
      transferId: null,
      backupPath: null,
      partialPath: null,
    };
    const changed = () => BrowserWindow.getAllWindows()[0]!.webContents.send('remote-edit:changed');
    ipcMain.removeHandler('remote-edit:state');
    ipcMain.handle('remote-edit:state', () => ({ ok: true, value: state }));
    ipcMain.removeHandler('remote-edit:reopen');
    ipcMain.handle('remote-edit:reopen', () => ({ ok: true, value: undefined }));
    ipcMain.removeHandler('remote-edit:upload');
    ipcMain.handle('remote-edit:upload', () => {
      state = state && { ...state, changed: false, backupPath: '/remote/editor-original.bak' };
      changed();
      return { ok: true, value: undefined };
    });
    ipcMain.removeHandler('remote-edit:finish');
    ipcMain.handle('remote-edit:finish', (_event, choice: string) => {
      const kept = choice === 'keep' ? (state?.workingDirectory ?? null) : null;
      state = null;
      changed();
      return { ok: true, value: kept };
    });
  }, userData);
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'Start local shell', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Remote editor', exact: true });
  await expect(editor.getByRole('status')).toContainText('Saved changes pending');
  await editor.getByRole('button', { name: 'Open editor', exact: true }).click();
  await editor.getByRole('button', { name: 'Upload changes', exact: true }).click();
  await editor.getByRole('button', { name: 'Show editor details', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Upload changes', exact: true })).toBeDisabled();
  await expect(editor).toContainText('/remote/editor-original.bak');
  await editor.getByRole('button', { name: 'Discard local copy…', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Discard remote editing copy?' });
  await expect(dialog).toContainText(`${userData}/private-edit`);
  await expect(dialog).toContainText('Remote files and backups are kept.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Open editor', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Discard local copy…', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Discard remote editing copy?' });
  await dialog.getByRole('button', { name: 'Discard local copy', exact: true }).click();
  await expect(editor).toContainText(
    'Local working folder discarded. Remote files and backups were kept.',
  );
  await expect(editor.getByRole('button', { name: 'Open editor', exact: true })).toBeHidden();
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
  await expect(page.getByRole('region', { name: 'Workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start local shell' })).toBeVisible();
  await expect(navButton('Workspace')).toHaveAttribute('aria-current', 'page');

  await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible();
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
  await navButton('Workspace').click();
  await navButton('Hosts').click();
  await expect(search).toHaveValue('staging');
  await page.getByRole('button', { name: 'Clear host search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Your connections start here' })).toBeVisible();
});

test('switches views with keyboard shortcuts and shows live sidebar counts', async () => {
  await expect(navButton('Hosts')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+Alt+2');
  await expect(navButton('Workspace')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'No terminal tabs' })).toBeVisible();
  await page.keyboard.press('Control+Alt+3');
  await expect(navButton('Settings')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+Alt+1');
  await expect(navButton('Hosts')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'New terminal', exact: true })).toBeVisible();
});

test('keeps navigation and search usable at the minimum desktop window size', async () => {
  await page.setViewportSize({ width: 760, height: 520 });
  await expect(page.getByRole('searchbox', { name: 'Search hosts' })).toBeVisible();
  await expect(navButton('Settings')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath('hosts-minimum.png') });
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible();
  await navButton('Hosts').click();
  await expect(page.getByRole('heading', { name: 'Hosts', exact: true })).toBeVisible();
});

test('saves appearance and rejects malformed preference IPC without changing saved values', async () => {
  await navButton('Settings').click();
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
  await navButton('Settings').click();
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
  await navButton('Workspace').click();
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
  await navButton('Hosts').click();
  await navButton('Workspace').click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await terminalAction('Close session');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'No terminal tabs' })).toBeVisible();
});

test('rejects an unavailable shell override while preserving saved preferences', async () => {
  await navButton('Settings').click();
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
  await navButton('Workspace').click();
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
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
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
  await navButton('Workspace').click();
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
  await navButton('Hosts').click();
  await page.setViewportSize({ width: 1000, height: 700 });
  await navButton('Workspace').click();
  await checkSize('RESTORED');
});

test('creates independent tabs, renames, reorders, switches, and confirms closing', async () => {
  await navButton('Workspace').click();
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
  await tabAction('Terminal 2', 'Rename…');
  await page.getByRole('dialog').getByLabel('Terminal name').fill('Build shell');
  await page.keyboard.press('Control+Alt+1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(navButton('Workspace')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
  await tabAction('Build shell', 'Move left');
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

test('splits local sessions in both directions, preserves them across navigation, and closes only the chosen pane', async () => {
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const first = page.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
  await expect(first.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const original = await first.locator('.xterm').elementHandle();
  await page.keyboard.type("MT_SPLIT_KEEP=original; printf 'ORIGINAL_READY\\n'");
  await page.keyboard.press('Enter');
  await expect(first.locator('.xterm-accessibility-tree')).toContainText('ORIGINAL_READY');
  await terminalAction('Split right');
  const second = page.getByRole('tabpanel', { name: 'Terminal 2', exact: true });
  await expect(second.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await expect(first).toBeVisible();
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  const left = (await first.boundingBox())!;
  const right = (await second.boundingBox())!;
  expect(Math.abs(right.x - (left.x + left.width))).toBeLessThan(2);
  expect(Math.abs(right.y - left.y)).toBeLessThan(2);
  await page.keyboard.type('printf \'NEW_SESSION=%s\\n\' "${MT_SPLIT_KEEP-unset}"');
  await page.keyboard.press('Enter');
  await expect(second.locator('.xterm-accessibility-tree')).toContainText('NEW_SESSION=unset');
  await terminalAction('Split down');
  const third = page.getByRole('tabpanel', { name: 'Terminal 3', exact: true });
  await expect(third.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const upper = (await second.boundingBox())!;
  const lower = (await third.boundingBox())!;
  expect(Math.abs(lower.y - (upper.y + upper.height))).toBeLessThan(2);
  expect(Math.abs(lower.x - upper.x)).toBeLessThan(2);
  await first.locator('.xterm-screen').click();
  await expect(first).toHaveAttribute('data-active', 'true');
  await expect(page.getByRole('tab', { name: 'Terminal 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.type('printf \'KEPT=%s\\n\' "$MT_SPLIT_KEEP"');
  await page.keyboard.press('Enter');
  await expect(first.locator('.xterm-accessibility-tree')).toContainText('KEPT=original');
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(first).toBeHidden();
  await expect(second).toBeHidden();
  await expect(third).toBeHidden();
  await page.getByRole('tab', { name: 'Terminal 2', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(third).toBeVisible();
  await navButton('Hosts').click();
  await navButton('Workspace').click();
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Close Terminal 2', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(second).toBeVisible();
  await page.getByRole('button', { name: 'Close Terminal 2', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect(second).toHaveCount(0);
  await expect(first).toBeVisible();
  await expect(third).toBeVisible();
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  await first.locator('.xterm-screen').click();
  await page.keyboard.type('printf \'STILL_ALIVE=%s\\n\' "$MT_SPLIT_KEEP"');
  await page.keyboard.press('Enter');
  await expect(first.locator('.xterm-accessibility-tree')).toContainText('STILL_ALIVE=original');
});

test('resizes split panes with pointer and accessible separator keys while retaining sessions', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  const shells = await page.evaluate(() => window.mterminal.getShells());
  const bash = shells.find((shell) => shell.name === 'bash');
  test.skip(info.platform === 'win32' || !bash, 'The PTY grid fixture requires Bash/stty.');
  await page.evaluate(async (path) => {
    const preferences = await window.mterminal.getPreferences();
    await window.mterminal.savePreferences({ ...preferences, defaultShell: path! });
  }, bash?.path);
  await page.setViewportSize({ width: 1200, height: 800 });
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const first = page.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
  await expect(first.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const original = await first.locator('.xterm').elementHandle();
  await terminalAction('Split right');
  const second = page.getByRole('tabpanel', { name: 'Terminal 2', exact: true });
  await expect(second.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize panes 1' });
  const before = (await first.boundingBox())!;
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 100, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await first.boundingBox())!.width)
    .toBeGreaterThan(before.width + 60);
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  const afterDrag = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus();
  await divider.press('ArrowLeft');
  await expect
    .poll(async () => Number(await divider.getAttribute('aria-valuenow')))
    .toBeLessThan(afterDrag);
  await divider.press('Home');
  await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBe(260);
  await divider.press('End');
  await expect.poll(async () => Math.round((await second.boundingBox())!.width)).toBe(260);
  await divider.press('Enter');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  const reset = (await divider.boundingBox())!;
  await page.mouse.move(reset.x + 3, reset.y + reset.height / 2);
  await page.mouse.down();
  await page.mouse.move(reset.x - 80, reset.y + reset.height / 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  // Compare the remote PTY grid with xterm's bottom-right cursor report.
  await first.locator('.xterm-screen').click();
  const command = `saved=$(stty -g); stty -echo -icanon min 1 time 0; printf '\\033[999;999H\\033[6n'; IFS= read -r -d R reply; stty "$saved"; reply=\${reply#$'\\e['}; set -- $(stty size); printf 'F38_GRID:%sx%s:%s\\n' "$1" "$2" "$reply"`;
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
  await expect(first.locator('.xterm-accessibility-tree')).toContainText(
    /F38_GRID:(\d+)x(\d+):\1;\2/,
  );
  await page.setViewportSize({ width: 560, height: 400 });
  await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThanOrEqual(260);
  expect((await second.boundingBox())!.width).toBeGreaterThanOrEqual(260);
  expect(
    await page
      .locator('.terminal-panels')
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
});

test('moves pane focus and resizes by shortcut without sending shortcut bytes to the shell', async () => {
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await terminalAction('Split right');
  const second = page.getByRole('tabpanel', { name: 'Terminal 2', exact: true });
  await expect(second.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await terminalAction('Split down');
  const first = page.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
  const third = page.getByRole('tabpanel', { name: 'Terminal 3', exact: true });
  await expect(third.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await application.evaluate(({ ipcMain }) => {
    let writes = 0;
    ipcMain.on('terminal:write', (_event, _id, input: { data: string }) => {
      // Ignore terminal replies to a shell's cursor-position query.
      if (!(input.data.charCodeAt(0) === 27 && /^\[\d+;\d+R$/.test(input.data.slice(1)))) writes++;
    });
    ipcMain.on('fixture:pane-write-count', (_event, respond: (value: number) => void) =>
      respond(writes),
    );
  });
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expect(second).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await expect(first).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await expect(second).toHaveAttribute('data-active', 'true');
  const horizontal = page.getByRole('separator', { name: 'Resize panes 2' });
  const beforeVertical = (await second.boundingBox())!.height;
  const sash = (await horizontal.boundingBox())!;
  await page.mouse.move(sash.x + sash.width / 2, sash.y + 3);
  await page.mouse.down();
  await page.mouse.move(sash.x + sash.width / 2, sash.y + 45, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await second.boundingBox())!.height)
    .toBeGreaterThan(beforeVertical + 20);
  await horizontal.press('Enter');
  await second.locator('.xterm-screen').click();
  await page.keyboard.press('Control+Alt+Shift+ArrowDown');
  await expect(horizontal).toHaveAttribute('aria-valuenow', '52');
  await expect(second).toHaveAttribute('data-active', 'true');
  await page.evaluate(() => window.mterminal.getVaultState());
  const writes = await application.evaluate(
    ({ ipcMain }) =>
      new Promise<number>((resolve) => ipcMain.emit('fixture:pane-write-count', null, resolve)),
  );
  expect(writes).toBe(0);
  await second.getByRole('button', { name: 'Search', exact: true }).click();
  const search = second.getByRole('search').getByRole('searchbox');
  await search.fill('search terms');
  await search.press('Alt+Shift+ArrowDown');
  await expect(search).toBeFocused();
  await expect(second).toHaveAttribute('data-active', 'true');
  await second.getByRole('button', { name: 'Close terminal search' }).click();
  await navButton('Settings').click();
  await page.getByLabel('Enable workspace and pane navigation shortcuts').uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible();
  await navButton('Workspace').click();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(second).toHaveAttribute('data-active', 'true');
});

test('split SSH panes connect independently without copying a one-time login', async () => {
  await application.evaluate(({ ipcMain }) => {
    const calls: { id: string; hostId: string; username: string }[] = [];
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle(
      'terminal:ssh',
      (event, id: string, _size, hostId: string, credentials: { username: string }) => {
        calls.push({ id, hostId, username: credentials.username });
        event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
        return { ok: true };
      },
    );
    ipcMain.on('fixture:split-ssh-calls', (_event, respond: (value: typeof calls) => void) =>
      respond(calls),
    );
  });
  const hostId = await page.evaluate(
    async () =>
      (
        await window.mterminal.saveHost({
          name: 'Split SSH',
          address: 'example.internal',
          port: 22,
          username: '',
          protocol: 'ssh',
        })
      ).id,
  );
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Split SSH', exact: true }).click();
  let prompt = page.getByRole('dialog');
  await prompt.getByLabel('SSH username').fill('first-user');
  await prompt.getByLabel('Password', { exact: true }).fill('fixture-secret');
  await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toHaveCount(1);
  await terminalAction('Split right');
  prompt = page.getByRole('dialog');
  await expect(prompt.getByLabel('SSH username')).toHaveValue('');
  await expect(prompt.getByLabel('Password', { exact: true })).toHaveValue('');
  await prompt.getByLabel('SSH username').fill('second-user');
  await prompt.getByLabel('Password', { exact: true }).fill('other-fixture-secret');
  await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toHaveCount(2);
  const calls = await application.evaluate(
    ({ ipcMain }) =>
      new Promise<{ id: string; hostId: string; username: string }[]>((resolve) =>
        ipcMain.emit('fixture:split-ssh-calls', null, resolve),
      ),
  );
  expect(calls.map((call) => ({ hostId: call.hostId, username: call.username }))).toEqual([
    { hostId, username: 'first-user' },
    { hostId, username: 'second-user' },
  ]);
  expect(calls[0]?.id).not.toBe(calls[1]?.id);
  await terminalAction('Close session');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close terminal', exact: true })
    .click();
  await expect(page.locator('.terminal-pane:not([hidden])')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toHaveCount(1);
});

test('saves a split workspace, reopens idle panes after reload and explicitly starts just one', async () => {
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await terminalAction('Split right');
  const first = page.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
  const second = page.getByRole('tabpanel', { name: 'Terminal 2', exact: true });
  await expect(second.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize panes 1' });
  await divider.focus();
  for (let n = 0; n < 5; n++) await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '60');
  await page.getByRole('button', { name: 'Workspace templates', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Workspace templates', exact: true });
  await dialog.getByLabel('Template name', { exact: true }).fill('Development');
  await dialog.getByRole('button', { name: 'Save new template' }).click();
  await expect(dialog.getByLabel('Saved template')).toContainText('Development');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  // Opening a template adds panes and leaves both live originals intact.
  const original = await first.locator('.xterm').elementHandle();
  await page.getByRole('button', { name: 'Workspace templates', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open layout', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(4);
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(
    page
      .locator('.terminal-pane:not([hidden])')
      .getByRole('status')
      .filter({ hasText: 'No active session' }),
  ).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await application.evaluate(({ ipcMain }) => {
    let starts = 0;
    ipcMain.removeHandler('terminal:open');
    ipcMain.handle('terminal:open', () => {
      starts++;
      return { ok: true };
    });
    ipcMain.on('fixture:template-starts', (_event, respond: (value: number) => void) =>
      respond(starts),
    );
  });
  await page.getByRole('button', { name: 'Workspace templates', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Workspace templates', exact: true });
  await expect(dialog.getByLabel('Saved template')).toContainText('Development');
  await dialog.getByRole('button', { name: 'Open layout', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('separator', { name: 'Resize panes 1' })).toHaveAttribute(
    'aria-valuenow',
    '60',
  );
  const count = () =>
    application.evaluate(
      ({ ipcMain }) =>
        new Promise<number>((resolve) => ipcMain.emit('fixture:template-starts', null, resolve)),
    );
  await page.evaluate(() => window.mterminal.getVaultState());
  expect(await count()).toBe(0);
  await page
    .getByRole('tabpanel', { name: 'Terminal 1', exact: true })
    .getByRole('button', { name: 'Start local shell', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toHaveCount(1);
  expect(await count()).toBe(1);
  await page.getByRole('button', { name: 'Workspace templates', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete template', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Delete template “Development”?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'Workspace templates', exact: true })
      .getByLabel('Saved template'),
  ).toContainText('Development');
  await page
    .getByRole('dialog', { name: 'Workspace templates', exact: true })
    .getByRole('button', { name: 'Delete template', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Delete template “Development”?' })
    .getByRole('button', { name: 'Delete template', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Workspace templates', exact: true }),
  ).toContainText('No saved templates yet.');
  expect(await count()).toBe(1);
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('refuses missing-host templates and malformed template IPC without starting SSH', async () => {
  const hostId = await page.evaluate(async () => {
    const host = await window.mterminal.saveHost({
      name: 'Template host',
      address: 'example.internal',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
    const id = crypto.randomUUID();
    const draft = {
      version: 1 as const,
      name: 'Remote',
      panes: [{ id, title: 'Remote pane', hostId: host.id }],
      layouts: [{ id }],
      activeId: id,
    };
    await window.mterminal.saveWorkspaceTemplate(draft);
    return host.id;
  });
  await page.getByRole('button', { name: 'Workspace templates', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open layout', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Remote pane', exact: true })
      .getByRole('button', { name: 'Connect SSH', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Remote pane', exact: true }).click();
  await page.evaluate((id) => window.mterminal.deleteHost(id), hostId);
  await page.getByRole('button', { name: 'Workspace templates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace templates', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('referenced SSH host has been deleted');
  await expect(dialog.getByRole('button', { name: 'Open layout', exact: true })).toBeDisabled();
  await expect(page.getByRole('tab')).toHaveCount(0);
  const rejected = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    const draft = {
      version: 1 as const,
      name: 'Bad',
      panes: [{ id, title: 'Local' }],
      layouts: [{ id }],
      activeId: id,
    };
    const results: boolean[] = [];
    for (const value of [
      { ...draft, password: 'must-not-store' },
      { ...draft, command: 'never-run' },
      { ...draft, layouts: [{ id: crypto.randomUUID() }] },
    ]) {
      try {
        await window.mterminal.saveWorkspaceTemplate(value);
        results.push(false);
      } catch {
        results.push(true);
      }
    }
    return results;
  });
  expect(rejected).toEqual([true, true, true]);
  expect(await page.evaluate(() => window.mterminal.listWorkspaceTemplates())).toHaveLength(1);
});

test('supports terminal tab keyboard navigation, rename, and reorder', async () => {
  await navButton('Workspace').click();
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
});

test('copies selection and confirms/cancels multiline paste without touching the real OS clipboard', async () => {
  // Replace clipboard IO only inside this isolated Electron test process.
  await application.evaluate(({ clipboard }) => {
    clipboard.readText = async () => 'echo CLIP_SINGLE';
    clipboard.writeText = async (text) => {
      Reflect.set(globalThis, '__copiedFixtureText', text);
    };
  });
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const actions = await openTerminalMenu();
  await expect(actions.getByRole('menuitem', { name: 'Copy', exact: true })).toBeDisabled();
  await actions.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Text pasted.' })).toBeVisible();
  const textarea = page.locator('.terminal-pane:not([hidden]) textarea');
  await textarea.press('Enter');
  await expect(
    page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree'),
  ).toContainText('CLIP_SINGLE');
  await terminalAction('Select all');
  await terminalAction('Copy');
  await expect(page.getByRole('status').filter({ hasText: 'Selection copied.' })).toBeVisible();
  const copied = await application.evaluate(
    () => Reflect.get(globalThis, '__copiedFixtureText') as string,
  );
  expect(copied).toContain('CLIP_SINGLE');
  await application.evaluate(({ clipboard }) => {
    clipboard.readText = async () => 'echo MULTI_ONE\necho MULTI_TWO\n';
  });
  await terminalAction('Paste');
  const preview = page.getByRole('dialog', { name: 'Paste into “Terminal 1”?' });
  await expect(preview.getByLabel('Paste preview')).toContainText('echo MULTI_ONE');
  const tree = page.locator('.terminal-pane:not([hidden]) .xterm-accessibility-tree');
  await expect(tree).not.toContainText('MULTI_ONE');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tree).not.toContainText('MULTI_ONE');
  await terminalAction('Paste');
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
  await navButton('Workspace').click();
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
  await navButton('Workspace').click();
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

/** The visible terminal's tools panel, opened on the given tab. */
async function openTools(tab: 'Autocomplete' | 'History' | 'Snippets' | 'Themes') {
  const pane = page.locator('.terminal-pane[data-active="true"]:not([hidden])');
  const panel = pane.getByRole('complementary', { name: /^Terminal tools for/ });
  if (!(await panel.isVisible()))
    await pane.getByRole('button', { name: 'Terminal tools', exact: true }).click();
  await panel.getByRole('tab', { name: tab, exact: true }).click();
  return panel;
}

/** Isolated encrypted-store stand-in; actual cipher persistence is covered by store tests. */
async function snippetFixture() {
  await application.evaluate(({ ipcMain }) => {
    const snippets = new Map<
      string,
      { id: string; name: string; command: string; folder: string; tags: string[] }
    >();
    const startup = new Map<string, string>();
    const writes: { id: string; data: string }[] = [];
    ipcMain.removeHandler('vault:state');
    ipcMain.handle('vault:state', () => ({
      ok: true,
      value: { configured: true, locked: false, available: true },
    }));
    ipcMain.removeHandler('snippets:startup');
    ipcMain.handle('snippets:startup', (_event, target: string) => ({
      ok: true,
      value: snippets.get(startup.get(target) ?? '') ?? null,
    }));
    ipcMain.removeHandler('snippets:set-startup');
    ipcMain.handle('snippets:set-startup', (event, target: string, id: string | null) => {
      if (id) startup.set(target, id);
      else startup.delete(target);
      event.sender.send('snippets:changed');
      return { ok: true, value: undefined };
    });
    ipcMain.removeHandler('snippets:list');
    ipcMain.handle('snippets:list', () => ({ ok: true, value: [...snippets.values()] }));
    ipcMain.removeHandler('snippets:save');
    ipcMain.handle('snippets:save', (event, draft, existing?: string) => {
      const id = existing ?? crypto.randomUUID();
      const saved = { ...draft, id };
      snippets.set(id, saved);
      event.sender.send('snippets:changed');
      return { ok: true, value: saved };
    });
    ipcMain.removeHandler('snippets:delete');
    ipcMain.handle('snippets:delete', (event, id: string) => {
      snippets.delete(id);
      for (const [target, snippetId] of startup) if (snippetId === id) startup.delete(target);
      event.sender.send('snippets:changed');
      return { ok: true, value: undefined };
    });
    ipcMain.on('terminal:write', (_event, id: string, input: { data: string }) =>
      writes.push({ id, data: input.data }),
    );
    ipcMain.on('fixture:snippet-writes', (_event, respond: (value: typeof writes) => void) =>
      respond(writes),
    );
  });
}
async function snippetWrites() {
  await page.evaluate(() => window.mterminal.getVaultState());
  return application.evaluate(
    ({ ipcMain }) =>
      new Promise<{ id: string; data: string }[]>((resolve) =>
        ipcMain.emit('fixture:snippet-writes', null, resolve),
      ),
  );
}

test('creates, organizes and inserts a snippet without submitting it, then edits and confirms deletion', async () => {
  await snippetFixture();
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const panel = await openTools('Snippets');
  await panel.getByRole('button', { name: 'New snippet', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'New snippet', exact: true });
  await editor.getByLabel('Snippet name').fill('Inspect release');
  await editor.getByLabel('Command', { exact: true }).fill('echo SNIPPET_INSERT_VALUE');
  await editor.getByLabel('Folder', { exact: true }).fill('Work/Production');
  await editor.getByLabel('Tags (comma-separated)').fill('deploy, release');
  await editor.getByRole('button', { name: 'Save snippet', exact: true }).click();
  const item = panel.getByRole('listitem').filter({ hasText: 'Inspect release' });
  await expect(item).toBeVisible();
  await panel.getByRole('searchbox', { name: 'Search snippets' }).fill('RELEASE production');
  await expect(item).toBeVisible();
  await panel.getByLabel('Folder', { exact: true }).selectOption('Work');
  await item.getByRole('button', { name: 'Insert', exact: true }).click();
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('SNIPPET_INSERT_VALUE')),
  ).toEqual([{ id: expect.any(String), data: 'echo SNIPPET_INSERT_VALUE' }]);
  await page.keyboard.press('Control+u');
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Edit snippet', exact: true });
  await editor.getByLabel('Snippet name').fill('Inspect updated');
  await editor.getByLabel('Command', { exact: true }).fill('echo SNIPPET_UPDATED');
  await editor.getByRole('button', { name: 'Save snippet', exact: true }).click();
  await panel.getByRole('searchbox', { name: 'Search snippets' }).fill('updated');
  const updated = panel.getByRole('listitem').filter({ hasText: 'Inspect updated' });
  await expect(updated).toBeVisible();
  await updated.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete snippet “Inspect updated”?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(updated).toBeVisible();
  await updated.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete snippet “Inspect updated”?' })
    .getByRole('button', { name: 'Delete snippet', exact: true })
    .click();
  await expect(updated).toHaveCount(0);
});

test('confirms multiline snippet execution in one split pane and rejects a changed session', async () => {
  await snippetFixture();
  await page.evaluate(() =>
    window.mterminal.saveSnippet({
      name: 'Multiline',
      command: 'echo SNIPPET_FIRST_LINE\necho SNIPPET_SECOND_LINE',
      folder: '',
      tags: [],
    }),
  );
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await terminalAction('Split right');
  const pane = page.getByRole('tabpanel', { name: 'Terminal 2', exact: true });
  await expect(pane.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  let panel = await openTools('Snippets');
  const item = panel.getByRole('listitem').filter({ hasText: 'Multiline' });
  await expect(item.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await expect(async () => {
    await item.getByRole('button', { name: 'Run…', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Run “Multiline” in “Terminal 2”?' }),
    ).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 5000 });
  let confirmation = page.getByRole('dialog', { name: 'Run “Multiline” in “Terminal 2”?' });
  await expect(confirmation.locator('pre')).toContainText('SNIPPET_FIRST_LINE');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('SNIPPET_FIRST_LINE')),
  ).toHaveLength(0);
  await item.getByRole('button', { name: 'Run…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run snippet', exact: true }).click();
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('SNIPPET_SECOND_LINE');
  const commands = (await snippetWrites()).filter((write) =>
    write.data.includes('SNIPPET_FIRST_LINE'),
  );
  expect(commands).toHaveLength(1);
  expect(new Set(commands.map((write) => write.id)).size).toBe(1);
  panel = await openTools('Snippets');
  await expect(async () => {
    await panel
      .getByRole('listitem')
      .filter({ hasText: 'Multiline' })
      .getByRole('button', { name: 'Run…', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Run “Multiline” in “Terminal 2”?' }),
    ).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 5000 });
  confirmation = page.getByRole('dialog', { name: 'Run “Multiline” in “Terminal 2”?' });
  await application.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send('terminal:event', {
        kind: 'exit',
        id,
        exitCode: 0,
      }),
    commands[0]!.id,
  );
  await confirmation.getByRole('button', { name: 'Run snippet', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('target session changed');
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('SNIPPET_FIRST_LINE')),
  ).toHaveLength(1);
});

test('assigns a local startup action, skips/cancels without sending and submits once on a new connection', async () => {
  await snippetFixture();
  const snippet = await page.evaluate(() =>
    window.mterminal.saveSnippet({
      name: 'Startup check',
      command: 'echo STARTUP_APPROVED_VALUE',
      folder: '',
      tags: [],
    }),
  );
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const tools = await openTools('Snippets');
  const assignment = tools.getByRole('region', { name: 'Startup snippet assignment' });
  await assignment.getByRole('combobox').selectOption(snippet.id);
  await assignment.getByRole('button', { name: 'Save startup assignment' }).click();
  await expect(assignment.getByRole('status')).toContainText('saved for new connections');
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const second = page.getByRole('tabpanel', { name: 'Terminal 2', exact: true });
  await expect(second.getByRole('button', { name: 'Review startup' })).toBeVisible();
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('STARTUP_APPROVED_VALUE')),
  ).toHaveLength(0);
  await expect(async () => {
    await second.getByRole('button', { name: 'Review startup' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Run “Startup check” in “Terminal 2”?' }),
    ).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 5000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    second.getByRole('status').filter({ hasText: 'skipped for this session' }),
  ).toBeVisible();
  await expect(second.getByRole('button', { name: 'Review startup' })).toHaveCount(0);
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('STARTUP_APPROVED_VALUE')),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const third = page.getByRole('tabpanel', { name: 'Terminal 3', exact: true });
  await expect(third.getByRole('button', { name: 'Review startup' })).toBeVisible();
  await expect(async () => {
    await third.getByRole('button', { name: 'Review startup' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Run “Startup check” in “Terminal 3”?' }),
    ).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 5000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Run snippet', exact: true }).click();
  await expect(
    third.getByRole('status').filter({ hasText: 'Completion is not verified' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Terminal 2', exact: true }).click();
  await page.getByRole('tab', { name: 'Terminal 3', exact: true }).click();
  await expect(third.getByRole('button', { name: 'Review startup' })).toHaveCount(0);
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('STARTUP_APPROVED_VALUE')),
  ).toHaveLength(1);
  await third.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(third.getByRole('status').filter({ hasText: 'Shell exited' })).toBeVisible();
  await third.getByRole('button', { name: 'Start local shell', exact: true }).click();
  await expect(third.getByRole('button', { name: 'Review startup' })).toBeVisible();
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('STARTUP_APPROVED_VALUE')),
  ).toHaveLength(1);
  await third.getByRole('button', { name: 'Skip startup' }).click();
  await expect(third.getByRole('button', { name: 'Review startup' })).toHaveCount(0);
});

test('reviews a host startup action and refuses an assignment removed while confirmation is open', async () => {
  await snippetFixture();
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', (event, id: string) => {
      event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
      return { ok: true };
    });
  });
  const hostId = await page.evaluate(async () => {
    const host = await window.mterminal.saveHost({
      name: 'Startup host',
      address: 'example.internal',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
    const snippet = await window.mterminal.saveSnippet({
      name: 'Remote startup',
      command: 'echo STARTUP_REMOTE_VALUE',
      folder: '',
      tags: [],
    });
    await window.mterminal.setStartupSnippet(host.id, snippet.id);
    return host.id;
  });
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Startup host', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review startup' })).toBeVisible();
  await page.getByRole('button', { name: 'Review startup' }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Run “Remote startup” in “Startup host”?',
  });
  await expect(confirmation.locator('pre')).toHaveText('echo STARTUP_REMOTE_VALUE');
  await page.evaluate((id) => window.mterminal.setStartupSnippet(id, null), hostId);
  await confirmation.getByRole('button', { name: 'Run snippet', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('assignment or command changed');
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('STARTUP_REMOTE_VALUE')),
  ).toHaveLength(0);
});

test('discards a startup lookup that finishes after the session has exited', async () => {
  await snippetFixture();
  const snippet = await page.evaluate(() =>
    window.mterminal.saveSnippet({
      name: 'Late startup',
      command: 'echo STARTUP_LATE_VALUE',
      folder: '',
      tags: [],
    }),
  );
  await application.evaluate(({ ipcMain }, snippet) => {
    let release: (() => void) | undefined;
    ipcMain.removeHandler('snippets:startup');
    ipcMain.handle(
      'snippets:startup',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, value: snippet });
        }),
    );
    ipcMain.on('fixture:startup-pending', (_event, respond: (value: boolean) => void) =>
      respond(!!release),
    );
    ipcMain.on('fixture:release-startup', (_event, respond: () => void) => {
      release?.();
      respond();
    });
  }, snippet);
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const pane = page.getByRole('tabpanel', { name: 'Terminal 1', exact: true });
  await expect
    .poll(() =>
      application.evaluate(
        ({ ipcMain }) =>
          new Promise<boolean>((resolve) => ipcMain.emit('fixture:startup-pending', null, resolve)),
      ),
    )
    .toBe(true);
  await pane.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(pane.getByRole('status').filter({ hasText: 'Shell exited' })).toBeVisible();
  await application.evaluate(
    ({ ipcMain }) =>
      new Promise<void>((resolve) => ipcMain.emit('fixture:release-startup', null, resolve)),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(pane.locator('.startup-notice')).toHaveCount(0);
  expect(
    (await snippetWrites()).filter((write) => write.data.includes('STARTUP_LATE_VALUE')),
  ).toHaveLength(0);
});

test('keeps terminal appearance settings independent between tabs', async () => {
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await terminalAction('Terminal appearance…');
  let panel = page.getByRole('complementary', { name: 'Terminal tools for Terminal 1' });
  await expect(panel.getByRole('tab', { name: 'Themes' })).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('radio', { name: 'mTerminal Light' }).check();
  await panel.getByRole('combobox', { name: 'Font size', exact: true }).selectOption('20');
  await panel.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('125');
  await panel.getByRole('combobox', { name: 'Cursor', exact: true }).selectOption('bar');
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  panel = await openTools('Themes');
  await expect(panel.getByRole('radio', { name: 'Follow app' })).toBeChecked();
  await expect(panel.getByRole('combobox', { name: 'Font size', exact: true })).toHaveValue('14');
  await page.getByRole('tab', { name: 'Terminal 1', exact: true }).click();
  panel = page.getByRole('complementary', { name: 'Terminal tools for Terminal 1' });
  await expect(panel.getByRole('radio', { name: 'mTerminal Light' })).toBeChecked();
  await expect(panel.getByRole('combobox', { name: 'Font size', exact: true })).toHaveValue('20');
  await panel.getByRole('button', { name: 'Reset appearance' }).click();
  await expect(panel.getByRole('combobox', { name: 'Cursor', exact: true })).toHaveValue('block');
});

test('lists Bash history, searches anywhere in a command and suggests while typing', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  test.skip(info.platform === 'win32', 'This fixture uses Bash.');
  await writeFile(
    join(userData, 'bash_history'),
    ['git status', 'git log --oneline', 'ls -la', 'echo PICKED_$((6 * 7))'].join('\n') + '\n',
  );
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const panel = await openTools('History');
  const commands = panel.getByRole('list', { name: 'Commands' });
  await expect(commands.getByRole('button', { name: 'ls -la', exact: true })).toBeVisible();
  await panel.getByRole('searchbox', { name: 'Search command history' }).fill('ONELINE');
  await expect(commands.getByRole('listitem')).toHaveCount(1);
  await expect(
    commands.getByRole('button', { name: 'git log --oneline', exact: true }),
  ).toBeVisible();
  // Bash history entries can be copied or inserted but not deleted from mTerminal.
  await panel.getByRole('button', { name: 'More actions for git log --oneline' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete…' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await openTools('Autocomplete');
  await expect(
    panel.getByRole('status').filter({ hasText: 'Suggestions are active' }),
  ).toBeVisible();
  await page.locator('.terminal-pane:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.type('git l');
  const suggestions = page.getByRole('listbox', { name: 'Command suggestions' });
  await expect(suggestions.getByRole('option')).toHaveText(['git log --oneline']);
  await page.keyboard.press('ArrowRight');
  await expect(suggestions).toBeHidden();
  await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText(
    'git log --oneline',
  );

  // Enter on a highlighted suggestion runs the whole suggested command.
  await page.keyboard.press('Control+U');
  await page.keyboard.type('echo PI');
  await expect(suggestions.getByRole('option')).toHaveText(['echo PICKED_$((6 * 7))']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText('PICKED_42');

  await panel.getByRole('combobox', { name: 'Autocomplete' }).selectOption('off');
  await expect(panel.getByRole('status').filter({ hasText: 'turned off' })).toBeVisible();
  const saved = await page.evaluate(() => window.mterminal.getPreferences());
  expect(saved.autocomplete).toBe(false);
});

test('renders terminal output with the bundled font and theme colours', async () => {
  const info = await page.evaluate(() => window.mterminal.getAppInfo());
  test.skip(info.platform === 'win32', 'This fixture uses a Unix shell.');
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.keyboard.type("printf '\\033[31mCSP_RED\\033[0m\\n'");
  await page.keyboard.press('Enter');
  const rows = page.locator('.terminal-pane:not([hidden]) .xterm-rows');
  const red = rows.getByText('CSP_RED', { exact: true });
  await expect(red).toBeVisible();
  // xterm's inline <style> rules are blocked by the CSP; these come from the mirrored sheet.
  expect(await rows.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    'JetBrains Mono',
  );
  expect(await red.evaluate((element) => getComputedStyle(element).color)).toBe(
    'rgb(240, 113, 120)',
  );
  expect(await page.evaluate(() => document.fonts.check('14px "JetBrains Mono"', 'A'))).toBe(true);
});

test('opens terminal and tab menus from the keyboard', async () => {
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  const tab = page.getByRole('tab', { name: 'Terminal 1', exact: true });
  await tab.focus();
  await tab.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Tab actions for Terminal 1' });
  await expect(menu.getByRole('menuitem', { name: 'Rename…' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(tab).toBeFocused();
  await page.locator('.terminal-pane:not([hidden]) .terminal-container').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Actions for Terminal 1' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('cancelling window close preserves an active terminal', async () => {
  await navButton('Workspace').click();
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
  await navButton('Workspace').click();
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
  await terminalAction('Close session');
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
  await navButton('Workspace').click();
  await page.getByRole('button', { name: 'Start local shell' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell running' })).toBeVisible();
  await page.keyboard.type(
    "awk 'BEGIN { for (i=0; i<30000; i++) print i, \"terminal output workload\" }'; printf '\\nF16_%s\\n' DONE",
  );
  await page.keyboard.press('Enter');
  await navButton('Hosts').click();
  await navButton('Workspace').click();
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
  await form.getByLabel('Username', { exact: true }).fill('deploy');
  await form.getByRole('button', { name: 'Save host' }).click();
  await expect(page.getByText('Build server', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Build server', { exact: true })).toBeVisible();
  await page.getByLabel('Search hosts').fill('missing');
  await expect(page.getByRole('heading', { name: 'No matching hosts' })).toBeVisible();
  await page.getByLabel('Clear host search').click();
  await page.getByRole('button', { name: 'Edit Build server' }).click();
  await form.getByLabel('Port', { exact: true }).fill('2222');
  await form.getByRole('button', { name: 'Save host' }).click();
  await expect(page.getByText('deploy@build.example.com:2222', { exact: true })).toBeVisible();
  await hostAction('Build server', 'Delete…');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Build server', { exact: true })).toBeVisible();
  await hostAction('Build server', 'Delete…');
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
  // Reopen Hosts so it reloads the records saved above.
  await navButton('Settings').click();
  await navButton('Hosts').click();
  const production = page.getByRole('button', { name: 'Connect to Production', exact: true });
  await expect(production).toBeHidden();
  await page.getByRole('button', { name: 'Work 1 host', exact: true }).click();
  await page.getByRole('button', { name: 'Production 1 host', exact: true }).click();
  await expect(production).toContainText('ops@prod.example.com:2222');
  await page
    .getByRole('navigation', { name: 'Group' })
    .getByRole('button', { name: 'Work' })
    .click();
  await expect(production).toBeHidden();
  await page
    .getByRole('group', { name: 'Filter by tag' })
    .getByRole('button', { name: 'prod' })
    .click();
  await expect(production).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Results (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect((await page.evaluate(() => window.mterminal.listHostGroups())).length).toBe(2);
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete group', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Group' })).not.toContainText('Work');
  await expect(production).toContainText('ops@prod.example.com:2222');
  await expect(page.getByRole('button', { name: 'Work 1 host' })).toBeHidden();
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
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No active session' })).toBeVisible();
});

test('rejects saved-login writes for non-host owners and malformed credentials', async () => {
  const rejected = await page.evaluate(async () => {
    const host = await window.mterminal.saveHost({
      name: 'Login validation',
      address: 'example.internal',
      port: 22,
      username: '',
      protocol: 'ssh',
    });
    const identity = await window.mterminal.saveSshIdentity({
      name: 'Shared',
      username: 'shared-user',
      method: 'password',
    });
    const requests: [string, string, string][] = [
      [identity.id, 'root', 'fixture-secret'],
      ['04e9f162-d3cd-4c8f-a70a-2323a1751a9b', 'root', 'fixture-secret'],
      ['../host', 'root', 'fixture-secret'],
      [host.id, 'invalid user', 'fixture-secret'],
      [host.id, 'root', ''],
      [host.id, 'root', 'x'.repeat(4097)],
    ];
    return Promise.all(
      requests.map(async ([owner, username, password]) => {
        try {
          await window.mterminal.saveSshLogin(owner, username, password);
          return false;
        } catch {
          return true;
        }
      }),
    );
  });
  expect(rejected).toEqual([true, true, true, true, true, true]);
});

for (const mode of ['saved', 'once', 'setup'] as const) {
  test(`uses ${mode} login choice after closing and reopening the host`, async () => {
    await application.evaluate(({ ipcMain }, needsSetup) => {
      let configured = !needsSetup;
      ipcMain.removeHandler('vault:setup');
      ipcMain.handle('vault:setup', () => {
        configured = true;
        return { ok: true, value: undefined };
      });
      const passwords = new Map<string, { username: string; password: string }>();
      const calls: { username: string; saved: boolean; owner?: string }[] = [];
      ipcMain.removeHandler('vault:state');
      ipcMain.handle('vault:state', () => ({
        ok: true,
        value: { configured, locked: false, available: true },
      }));
      ipcMain.removeHandler('vault:password-status');
      ipcMain.handle('vault:password-status', (_event, owner: string) => ({
        ok: true,
        value: {
          available: true,
          saved: passwords.has(owner),
          username: passwords.get(owner)?.username,
        },
      }));
      ipcMain.removeHandler('vault:save-login');
      ipcMain.handle(
        'vault:save-login',
        (_event, owner: string, username: string, password: string) => {
          passwords.set(owner, { username, password });
          return { ok: true, value: undefined };
        },
      );
      ipcMain.removeHandler('terminal:ssh');
      ipcMain.handle(
        'terminal:ssh',
        (
          event,
          id: string,
          _size,
          _host,
          credentials: {
            username: string;
            useSavedPassword?: boolean;
            savedPasswordIdentityId?: string;
          },
        ) => {
          calls.push({
            username: credentials.username,
            saved: !!credentials.useSavedPassword,
            ...(credentials.savedPasswordIdentityId
              ? { owner: credentials.savedPasswordIdentityId }
              : {}),
          });
          event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
          return { ok: true };
        },
      );
      ipcMain.on('fixture:remembered-calls', (_event, respond: (value: typeof calls) => void) =>
        respond(calls),
      );
    }, mode === 'setup');
    const id = await page.evaluate(
      async () =>
        (
          await window.mterminal.saveHost({
            name: 'Remember login',
            address: 'example.internal',
            port: 22037,
            username: '',
            protocol: 'ssh',
          })
        ).id,
    );
    await navButton('Hosts').click();
    await page.getByRole('button', { name: 'Connect to Remember login', exact: true }).click();
    const prompt = page.getByRole('dialog');
    await prompt.getByLabel('SSH username').fill('root');
    await prompt.getByLabel('Password', { exact: true }).fill('fixture-secret');
    const saveLogin = prompt.getByRole('checkbox', {
      name: 'Save username and password for this host',
    });
    await expect(saveLogin).not.toBeChecked();
    if (mode !== 'once') await saveLogin.check();
    if (mode === 'setup') {
      const setup = page.getByRole('dialog', { name: 'Set up local vault' });
      await setup.getByLabel('Vault passphrase', { exact: true }).fill('fixture vault passphrase');
      await setup.getByLabel('Confirm passphrase').fill('fixture vault passphrase');
      await setup.getByRole('button', { name: 'Create vault', exact: true }).click();
      await expect(setup).toBeHidden();
      await expect(prompt.getByLabel('SSH username')).toHaveValue('root');
      await expect(prompt.getByLabel('Password', { exact: true })).toHaveValue('fixture-secret');
    }
    await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
    expect(
      await page.evaluate(
        async () =>
          (await window.mterminal.listHosts()).find((host) => host.name === 'Remember login')
            ?.username,
      ),
    ).toBe('');
    await page.getByRole('button', { name: 'Close Remember login', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close terminal', exact: true })
      .click();
    await navButton('Hosts').click();
    await page.getByRole('button', { name: 'Connect to Remember login', exact: true }).click();
    if (mode === 'once') {
      await expect(page.getByRole('dialog').getByLabel('SSH username')).toHaveValue('');
      await expect(page.getByRole('dialog').getByLabel('Password', { exact: true })).toHaveValue(
        '',
      );
    } else {
      await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    const calls = await application.evaluate(
      ({ ipcMain }) =>
        new Promise<{ username: string; saved: boolean; owner?: string }[]>((resolve) =>
          ipcMain.emit('fixture:remembered-calls', null, resolve),
        ),
    );
    expect(calls).toHaveLength(mode === 'once' ? 1 : 2);
    if (mode !== 'once') expect(calls[1]).toEqual({ username: 'root', saved: true, owner: id });
    else
      expect(
        await page.evaluate((hostId) => window.mterminal.getSshPasswordStatus(hostId), id),
      ).toMatchObject({ saved: false });
  });
}

test('uses the host-owned saved password when the dialog still needs a username', async () => {
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('vault:state');
    ipcMain.handle('vault:state', () => ({
      ok: true,
      value: { configured: true, locked: false, available: true },
    }));
    ipcMain.removeHandler('vault:password-status');
    ipcMain.handle('vault:password-status', () => ({
      ok: true,
      value: { available: true, saved: true },
    }));
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle(
      'terminal:ssh',
      (
        event,
        id: string,
        _size,
        hostId: string,
        credentials: {
          useSavedPassword?: boolean;
          savedPasswordIdentityId?: string;
          password?: string;
        },
      ) => {
        if (
          !credentials.useSavedPassword ||
          credentials.savedPasswordIdentityId !== hostId ||
          credentials.password !== undefined
        )
          return { ok: false, code: 'vault-secret-missing' };
        event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
        return { ok: true };
      },
    );
  });
  await page.evaluate(async () =>
    window.mterminal.saveHost({
      name: 'Own password',
      address: 'example.internal',
      port: 22,
      username: '',
      protocol: 'ssh',
    }),
  );
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Own password', exact: true }).click();
  const prompt = page.getByRole('dialog');
  await expect(
    prompt.getByRole('checkbox', { name: 'Use the saved password', exact: true }),
  ).toBeChecked();
  await expect(prompt.getByLabel('Password', { exact: true })).toHaveCount(0);
  await prompt.getByLabel('SSH username').fill('root');
  await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
});

test('does not start SSH after cancelling a pending password save', async () => {
  await application.evaluate(({ ipcMain }) => {
    let release: (() => void) | undefined;
    let opened = 0;
    ipcMain.removeHandler('vault:state');
    ipcMain.handle('vault:state', () => ({
      ok: true,
      value: { configured: true, locked: false, available: true },
    }));
    ipcMain.removeHandler('vault:password-status');
    ipcMain.handle('vault:password-status', () => ({
      ok: true,
      value: { available: true, saved: false },
    }));
    ipcMain.removeHandler('vault:save-login');
    ipcMain.handle(
      'vault:save-login',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, value: undefined });
        }),
    );
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', () => {
      opened++;
      return { ok: true };
    });
    ipcMain.on('fixture:finish-save', (_event, respond: () => void) => {
      release?.();
      respond();
    });
    ipcMain.on('fixture:opened-count', (_event, respond: (value: number) => void) =>
      respond(opened),
    );
  });
  await page.evaluate(async () =>
    window.mterminal.saveHost({
      name: 'Cancel saved login',
      address: 'example.internal',
      port: 22,
      username: 'root',
      protocol: 'ssh',
    }),
  );
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Cancel saved login', exact: true }).click();
  const prompt = page.getByRole('dialog');
  await prompt.getByLabel('Password', { exact: true }).fill('fixture-secret');
  await prompt.getByRole('checkbox', { name: 'Save username and password for this host' }).check();
  await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(prompt.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
  await application.evaluate(
    ({ ipcMain }) =>
      new Promise<void>((resolve) => {
        ipcMain.emit('fixture:finish-save', null, resolve);
      }),
  );
  await page.evaluate(() => window.mterminal.getVaultState());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const opened = await application.evaluate(
    ({ ipcMain }) =>
      new Promise<number>((resolve) => {
        ipcMain.emit('fixture:opened-count', null, resolve);
      }),
  );
  expect(opened).toBe(0);
});

test('connects a host with its saved password in one click, and asks again if rejected', async () => {
  const vault = await page.evaluate(() => window.mterminal.getVaultState());
  test.skip(!vault.available, 'OS secure storage is unavailable on this machine.');
  // Isolated IPC fixture: records what the renderer sends instead of contacting a server.
  await application.evaluate(({ ipcMain }) => {
    const calls: unknown[] = [];
    (globalThis as { sshCalls?: unknown[] }).sshCalls = calls;
    ipcMain.removeHandler('terminal:ssh');
    ipcMain.handle('terminal:ssh', (event, id: string, _size, _host, credentials) => {
      calls.push(credentials);
      if (calls.length > 1) return { ok: false, code: 'ssh-auth-failed' };
      event.sender.send('terminal:event', { kind: 'state', id, state: 'connected' });
      return { ok: true };
    });
  });
  const hostId = await page.evaluate(async () => {
    await window.mterminal.setupVault('e2e vault passphrase');
    const host = await window.mterminal.saveHost({
      name: 'Saved password',
      address: '127.0.0.1',
      port: 22,
      username: 'deploy',
      protocol: 'ssh',
    });
    return host.id;
  });
  await navButton('Settings').click();
  await navButton('Hosts').click();
  await hostAction('Saved password', 'Edit…');
  const editor = page.getByRole('dialog', { name: 'Edit “Saved password”' });
  const password = editor.getByLabel('Password', { exact: true });
  await password.fill('fixture-secret');
  await editor.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  // Connect in the panel saves the host and password, then connects without asking.
  await editor.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'SSH connected' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await application.evaluate(() => (globalThis as { sshCalls?: unknown[] }).sshCalls);
  expect(calls?.[0]).toMatchObject({ useSavedPassword: true, savedPasswordIdentityId: hostId });
  expect(calls?.[0]).not.toHaveProperty('password');

  // The server now rejects the saved password: the dialog explains and asks for a new one.
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Saved password', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: /onnect to “Saved password”/ });
  await expect(prompt.getByRole('alert')).toContainText('saved password was not accepted');
  await expect(prompt.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(
    prompt.getByRole('checkbox', { name: 'Save username and password for this host' }),
  ).not.toBeChecked();
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
  await navButton('Settings').click();
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'IdentityGroup 1 host', exact: true }).click();
  await page.getByRole('button', { name: 'Connect to Identity target', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await expect(dialog.getByLabel('Authentication method')).toHaveValue('privateKey');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('confirms SSH identity deletion in an app dialog that names the identity', async () => {
  await page.evaluate(async () => {
    await window.mterminal.saveSshIdentity({ name: 'Ops', username: 'ops', method: 'password' });
  });
  // Reopen Hosts so it reloads the records saved above.
  await navButton('Settings').click();
  await navButton('Hosts').click();
  page.on('dialog', (dialog) => {
    throw new Error(`Unexpected native ${dialog.type()} dialog`);
  });
  await page.getByRole('button', { name: 'SSH identities (1)' }).click();
  await page.getByRole('button', { name: 'Delete Ops', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: 'Delete SSH identity “Ops”?' });
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'SSH identities' })).toContainText('Ops');
  await page.getByRole('button', { name: 'Delete Ops', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: 'Delete SSH identity “Ops”?' });
  await confirmation.getByRole('button', { name: 'Delete identity' }).click();
  await expect(page.getByRole('button', { name: 'SSH identities (0)' })).toBeVisible();
});

test('generates, installs, and removes a managed key through app dialogs', async () => {
  const vault = await page.evaluate(() => window.mterminal.getVaultState());
  test.skip(!vault.available, 'OS secure storage is unavailable on this machine.');
  await page.evaluate(async () => {
    await window.mterminal.setupVault('e2e vault passphrase');
    const identity = await window.mterminal.saveSshIdentity({
      name: 'Keys',
      username: 'deploy',
      method: 'privateKey',
    });
    await window.mterminal.saveHost({
      name: 'Key target',
      address: '127.0.0.1',
      port: 2222,
      username: '',
      protocol: 'ssh',
      identityId: identity.id,
    });
  });
  // Reopen Hosts so it reloads the records saved above.
  await navButton('Settings').click();
  await navButton('Hosts').click();
  page.on('dialog', (dialog) => {
    throw new Error(`Unexpected native ${dialog.type()} dialog`);
  });
  await page.getByRole('button', { name: 'SSH identities (1)' }).click();
  const generate = page.getByRole('button', { name: 'Generate key', exact: true });
  test.skip(await generate.isDisabled(), 'Secure key storage is unavailable on this machine.');
  await generate.click();
  const passphrase = page.getByRole('dialog', { name: 'Generate SSH key for “Keys”' });
  await passphrase.getByLabel('Passphrase (optional)').fill('first-passphrase');
  await passphrase.getByLabel('Confirm passphrase').fill('other-passphrase');
  await passphrase.getByRole('button', { name: 'Generate key' }).click();
  await expect(passphrase.getByRole('alert')).toHaveText('The passphrases do not match.');
  await passphrase.getByLabel('Passphrase (optional)').fill('');
  await passphrase.getByRole('button', { name: 'Generate key' }).click();
  await expect(passphrase).toBeHidden();
  await expect(page.getByLabel('SSH public key')).toHaveValue(/^ssh-ed25519 /);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await hostAction('Key target', 'Install key…');
  const install = page.getByRole('dialog', { name: 'Install key on “Key target”' });
  await expect(install).toContainText('deploy@127.0.0.1:2222');
  await expect(install.getByLabel('Public key to install')).toHaveValue(/^ssh-ed25519 /);
  await expect(install.getByLabel('SSH password for deploy@127.0.0.1')).toBeFocused();
  await install.getByRole('button', { name: 'Cancel' }).click();
  await expect(install).toBeHidden();

  await page.getByRole('button', { name: 'SSH identities (1)' }).click();
  await page.getByRole('button', { name: 'Remove key', exact: true }).click();
  const removal = page.getByRole('dialog', { name: 'Remove the saved key for “Keys”?' });
  await removal.getByRole('button', { name: 'Remove key' }).click();
  await expect(removal).toBeHidden();
  await expect(page.getByText('No managed key')).toBeVisible();
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
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveCount(0);
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
    const actions = await openTerminalMenu();
    await expect(actions.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(actions).toBeHidden();
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
  await navButton('Settings').click();
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Failed startup' }).click();
  await expect(page.getByRole('dialog').getByLabel('SSH username')).toHaveValue('deploy');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'SSH failed.' })).toBeVisible();
  const progress = page.getByRole('region', { name: 'Connecting to Failed startup' });
  await expect(progress.getByRole('alert')).toContainText('SSH connection failed');
  await expect(progress.getByRole('button', { name: 'Retry' })).toBeVisible();
  await progress.getByRole('button', { name: 'Show logs' }).click();
  await expect(progress.getByRole('list', { name: 'Connection log' })).toContainText('Failed:');
  await progress.getByRole('button', { name: 'Close' }).click();
  await expect(progress).toBeHidden();
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
  await navButton('Settings').click();
  await navButton('Hosts').click();
  await page.getByRole('button', { name: 'Connect to Reconnect fixture' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await dialog.getByLabel('Password', { exact: true }).fill('fixture-1');
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
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(dialog).toContainText('previous session is lost');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.xterm-accessibility-tree').textContent()) ?? '')
    .toContain('F23_OUTPUT_1');
  expect((await inspect()).attempts).toHaveLength(1);
  await navButton('Hosts').click();
  await navButton('Workspace').click();
  expect((await inspect()).attempts).toHaveLength(1);
  await page.getByRole('button', { name: 'Reconnect SSH' }).click();
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('SSH username')).toHaveValue('deploy');
  await dialog.getByLabel('Password', { exact: true }).fill('fixture-2');
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
  await navButton('Settings').click();
  await navButton('Hosts').click();
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
