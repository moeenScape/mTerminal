import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { rebuild } from '@electron/rebuild';
const require = createRequire(import.meta.url);
await rebuild({
  buildPath: fileURLToPath(new URL('../', import.meta.url)),
  projectRootPath: fileURLToPath(new URL('../../../', import.meta.url)),
  electronVersion: require('electron/package.json').version,
  force: true,
  onlyModules: ['node-pty', '@serialport/bindings-cpp'],
});
console.log('node-pty and serialport rebuilt for the installed Electron version.');
