import type { AccountErrorCode } from '../../../../packages/shared/accounts.ts';

import type { LiveTypingGrant } from '../../../../packages/shared/live-share.ts';
export type { LiveTypingGrant };
export { LIVE_INPUT_CHARS } from '../../../../packages/shared/live-share.ts';

export const LIVE_REQUEST = 'account:live-terminal';
export const LIVE_CHANGED = 'account:live-terminal-changed';

export interface LiveState {
  active: boolean;
  typing?: 'host' | 'granting' | 'guest';
  guestReady?: boolean;
  reason?: AccountErrorCode;
}

export type LiveAction =
  | { kind: 'sessions' | 'status' | 'stop' | 'grant' | 'reclaim' }
  | { kind: 'start'; organizationId: string; vaultId: string; terminalId: string; email: string }
  | { kind: 'view'; invitation: string; after: number }
  | { kind: 'input'; invitation: string; lease: string; sequence: number; text: string }
  | { kind: 'yield'; invitation: string; lease: string };

export interface LiveView {
  state?: LiveState;
  invitation?: string;
  sessions?: { id: string; label: string }[];
  output?: string;
  cursor?: number;
  typing?: LiveTypingGrant | null;
}

export type LiveReply = { ok: true; view: LiveView } | { ok: false; code: AccountErrorCode };

export interface LiveApi {
  liveTerminal: (action: LiveAction) => Promise<LiveView>;
  onLiveTerminalChanged: (listener: (state: LiveState) => void) => () => void;
}
