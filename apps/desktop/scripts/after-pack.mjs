import { execFileSync } from 'node:child_process';

export default function afterPack({ electronPlatformName, appOutDir }) {
  // The Debian archive must not install application files writable by other users.
  if (electronPlatformName === 'linux') execFileSync('chmod', ['-R', 'go-w', '--', appOutDir]);
}
