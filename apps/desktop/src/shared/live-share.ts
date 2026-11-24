import type { AccountErrorCode } from '../../../../packages/shared/accounts.ts';

export const LIVE_REQUEST = 'account:live-terminal';
export const LIVE_CHANGED = 'account:live-terminal-changed';

export interface LiveState {
  active: boolean;
  reason?: AccountErrorCode;
}

export type LiveAction =
  | { kind: 'sessions' | 'status' | 'stop' }
  | { kind: 'start'; organizationId: string; vaultId: string; terminalId: string; email: string }
  | { kind: 'view'; invitation: string; after: number };

export interface LiveView {
  state?: LiveState;
  invitation?: string;
  sessions?: { id: string; label: string }[];
  output?: string;
  cursor?: number;
}

export type LiveReply = { ok: true; view: LiveView } | { ok: false; code: AccountErrorCode };

export interface LiveApi {
  liveTerminal: (action: LiveAction) => Promise<LiveView>;
  onLiveTerminalChanged: (listener: (state: LiveState) => void) => () => void;
}
