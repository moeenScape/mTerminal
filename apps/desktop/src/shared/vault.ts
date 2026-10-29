export const vaultChannels = {
  status: 'vault:password-status',
  save: 'vault:save-password',
  delete: 'vault:delete-password',
} as const;

export interface VaultApi {
  getSshPasswordStatus: (identityId: string) => Promise<{ available: boolean; saved: boolean }>;
  saveSshPassword: (identityId: string, password: string) => Promise<void>;
  deleteSshPassword: (identityId: string) => Promise<void>;
}

export type VaultResponse<T> =
  { ok: true; value: T } | { ok: false; code: import('./failures.js').FailureCode };
