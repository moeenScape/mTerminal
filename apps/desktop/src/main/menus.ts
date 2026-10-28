import type { MenuItemConstructorOptions } from 'electron';

export function applicationMenu(
  platform: NodeJS.Platform,
  packaged: boolean,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  return [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    mac
      ? { role: 'fileMenu' }
      : {
          label: 'File',
          submenu: [
            { role: 'close', accelerator: 'Ctrl+Shift+W' },
            { role: 'quit', accelerator: 'Ctrl+Shift+Q' },
          ],
        },
    mac
      ? { role: 'editMenu' }
      : {
          label: 'Edit',
          submenu: [
            { role: 'undo', accelerator: 'Ctrl+Shift+Z' },
            { role: 'redo', accelerator: 'Ctrl+Shift+Y' },
            { type: 'separator' },
            { role: 'cut', accelerator: 'Ctrl+Shift+X' },
            { role: 'copy', accelerator: 'Ctrl+Shift+C' },
            { role: 'paste', accelerator: 'Ctrl+Shift+V' },
            { role: 'selectAll', accelerator: 'Ctrl+Shift+A' },
          ],
        },
    {
      label: 'View',
      submenu: [
        ...(!packaged
          ? [
              { role: 'reload' as const, accelerator: mac ? 'Cmd+R' : 'Ctrl+Shift+R' },
              { role: 'toggleDevTools' as const },
            ]
          : []),
        { role: 'resetZoom', accelerator: mac ? 'Cmd+0' : 'Ctrl+Shift+0' },
        { role: 'zoomIn', accelerator: mac ? 'Cmd+Plus' : 'Ctrl+Shift+Plus' },
        { role: 'zoomOut', accelerator: mac ? 'Cmd+-' : 'Ctrl+Shift+-' },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: mac ? 'Ctrl+Cmd+F' : 'Ctrl+Shift+F11' },
      ],
    },
    mac
      ? { role: 'windowMenu' }
      : { label: 'Window', submenu: [{ role: 'minimize', accelerator: 'Ctrl+Shift+M' }] },
  ];
}
