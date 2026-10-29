import { createRequire } from 'node:module';
import type * as Ssh2 from 'ssh2';

const require = createRequire(import.meta.url);
const ssh2 = require('ssh2') as typeof Ssh2;

export const { Client, utils } = ssh2;
export type { ClientChannel, SFTPWrapper, Stats } from 'ssh2';
