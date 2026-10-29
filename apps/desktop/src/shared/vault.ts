export const vaultChannels = {
  status: 'vault:password-status',
  save: 'vault:save-password',
  delete: 'vault:delete-password',
  keyStatus: 'vault:key-status',
  keyImport: 'vault:key-import',
  keyGenerate: 'vault:key-generate',
  keyDelete: 'vault:key-delete',
} as const;

export interface VaultApi {
  getSshPasswordStatus: (identityId: string) => Promise<{ available: boolean; saved: boolean }>;
  saveSshPassword: (identityId: string, password: string) => Promise<void>;
  deleteSshPassword: (identityId: string) => Promise<void>;
  getSshKeyStatus: (
    identityId: string,
  ) => Promise<{ available: boolean; saved: boolean; publicKey?: string }>;
  importSshKey: (identityId: string, passphrase: string) => Promise<string>;
  generateSshKey: (identityId: string, passphrase: string) => Promise<string>;
  deleteSshKey: (identityId: string) => Promise<void>;
}

export type VaultResponse<T> =
  { ok: true; value: T } | { ok: false; code: import('./failures.js').FailureCode };
