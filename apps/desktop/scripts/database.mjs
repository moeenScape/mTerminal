// Offline maintenance only. Node 24 strips types from the storage module.
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { LocalDatabase, recoverDatabase } from '../src/main/storage/database.ts';

const [command, directory, snapshot, confirmation, ...extra] = process.argv.slice(2);
if (
  !directory ||
  extra.length ||
  !['backup', 'restore'].includes(command) ||
  (command === 'backup' && (snapshot !== '--app-closed' || confirmation)) ||
  (command === 'restore' && (!snapshot || confirmation !== '--app-closed'))
) {
  console.error(
    'Close mTerminal first. Usage:\n  npm run database -- backup <userData-directory> --app-closed\n  npm run database -- restore <userData-directory> <backup-file> --app-closed',
  );
  process.exitCode = 1;
} else {
  const path = join(resolve(directory), 'mterminal.sqlite');
  try {
    await stat(path);
    if (command === 'restore') {
      await recoverDatabase(resolve(snapshot), path);
      console.log('Database restored; the previous file was preserved beside it.');
    } else {
      const database = await LocalDatabase.open(path);
      try {
        console.log(await database.createBackup(join(resolve(directory), 'backups')));
      } finally {
        database.close();
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database maintenance failed.');
    process.exitCode = 1;
  }
}
