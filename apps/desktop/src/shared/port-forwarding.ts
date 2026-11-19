import { validHostId } from './hosts.ts';

export const forwardChannels = {
  rules: 'forwards:rules',
  saveRule: 'forwards:save-rule',
  deleteRule: 'forwards:delete-rule',
  state: 'forwards:state',
  start: 'forwards:start',
  stop: 'forwards:stop',
} as const;
export const FORWARDS_CHANGED = 'forwards:changed';

export const MAX_FORWARD_RULES = 20;
/** Active forwards across all sessions of one window. */
export const MAX_ACTIVE_FORWARDS = 32;
/** Simultaneous tunnelled connections per forward. */
export const MAX_FORWARD_CONNECTIONS = 64;

export type ForwardKind = 'local' | 'remote' | 'dynamic';

export interface PortForwardDraft {
  name: string;
  kind: ForwardKind;
  /** Local: listen address on this PC. Remote: listen address on the server. Dynamic: SOCKS listen address. */
  bindAddress: string;
  /** 0 lets the server choose a port (remote forwards only). */
  bindPort: number;
  /** Local: target as seen from the server. Remote: target as seen from this PC. Unused for dynamic. */
  destinationHost: string;
  destinationPort: number;
}
export interface PortForwardRule extends PortForwardDraft {
  id: string;
  hostId: string;
}

export type ForwardStatus = 'starting' | 'active' | 'failed';
export type ForwardError =
  | 'port-in-use'
  | 'port-denied'
  | 'address-unavailable'
  | 'remote-refused'
  | 'disconnected'
  | 'limit'
  | 'failed';
export const forwardErrorMessages: Record<ForwardError, string> = {
  'port-in-use': 'This port is already in use. Choose another port or stop the program using it.',
  'port-denied':
    'Permission denied for this port. Ports below 1024 usually need administrator rights; choose a higher port.',
  'address-unavailable':
    'The listen address is not available on this computer. Use 127.0.0.1 or an address of this PC.',
  'remote-refused':
    'The server refused the forwarding request. The port may be in use there, or the SSH server may disallow forwarding (AllowTcpForwarding / GatewayPorts).',
  disconnected: 'The SSH session disconnected. Reconnect and start the forward again.',
  limit: `At most ${MAX_ACTIVE_FORWARDS} forwards can run at the same time. Stop one first.`,
  failed: 'The forward could not be started. Check the rule and the connection, then retry.',
};

export interface ActiveForward {
  sessionId: string;
  rule: PortForwardRule;
  status: ForwardStatus;
  /** The port actually listening (differs from the rule when the server chose it). */
  boundPort: number | null;
  connections: number;
  totalConnections: number;
  failedConnections: number;
  error: ForwardError | null;
}

export interface ForwardsApi {
  listForwardRules: (hostId: string) => Promise<PortForwardRule[]>;
  saveForwardRule: (
    hostId: string,
    draft: PortForwardDraft,
    id?: string,
  ) => Promise<PortForwardRule>;
  deleteForwardRule: (id: string) => Promise<void>;
  getForwardState: () => Promise<ActiveForward[]>;
  startForward: (sessionId: string, ruleId: string) => Promise<void>;
  stopForward: (sessionId: string, ruleId: string) => Promise<void>;
  onForwardsChanged: (listener: () => void) => () => void;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
export function isLoopback(address: string): boolean {
  return LOOPBACK.has(address.toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(address);
}

function validAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 253 &&
    !value.startsWith('-') &&
    /^[A-Za-z0-9._:%[\]-]+$/.test(value)
  );
}
function validPort(value: unknown, allowZero: boolean): value is number {
  return Number.isInteger(value) && Number(value) >= (allowZero ? 0 : 1) && Number(value) <= 65535;
}

export function validatePortForward(value: unknown): PortForwardDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid forward.');
  const v = value as Record<string, unknown>;
  const allowed = ['name', 'kind', 'bindAddress', 'bindPort', 'destinationHost', 'destinationPort'];
  if (Object.keys(v).some((key) => !allowed.includes(key))) throw new Error('Invalid forward.');
  const kind = v.kind;
  if (kind !== 'local' && kind !== 'remote' && kind !== 'dynamic')
    throw new Error('Choose a forward type.');
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (
    name.length > 100 ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error('Use a name of at most 100 characters.');
  const bindAddress =
    typeof v.bindAddress === 'string' && v.bindAddress.trim() ? v.bindAddress.trim() : '127.0.0.1';
  if (!validAddress(bindAddress.replace(/^\[(.*)\]$/, '$1')))
    throw new Error('Enter a valid listen address.');
  if (!validPort(v.bindPort, kind === 'remote')) throw new Error('Enter a listen port (1–65535).');
  if (kind === 'dynamic')
    return {
      name,
      kind,
      bindAddress: bindAddress.replace(/^\[(.*)\]$/, '$1'),
      bindPort: Number(v.bindPort),
      destinationHost: '',
      destinationPort: 0,
    };
  const destinationHost = typeof v.destinationHost === 'string' ? v.destinationHost.trim() : '';
  if (!validAddress(destinationHost.replace(/^\[(.*)\]$/, '$1')))
    throw new Error('Enter a valid destination host.');
  if (!validPort(v.destinationPort, false)) throw new Error('Enter a destination port (1–65535).');
  return {
    name,
    kind,
    bindAddress: bindAddress.replace(/^\[(.*)\]$/, '$1'),
    bindPort: Number(v.bindPort),
    destinationHost: destinationHost.replace(/^\[(.*)\]$/, '$1'),
    destinationPort: Number(v.destinationPort),
  };
}

export function validForwardId(value: unknown): value is string {
  return validHostId(value);
}

/** Short human description, e.g. "localhost:8080 → db:5432". */
export function describeForward(rule: PortForwardDraft, boundPort?: number | null): string {
  const port = boundPort ?? rule.bindPort;
  const listen = `${rule.bindAddress.includes(':') ? `[${rule.bindAddress}]` : rule.bindAddress}:${port || 'auto'}`;
  const target = `${rule.destinationHost.includes(':') ? `[${rule.destinationHost}]` : rule.destinationHost}:${rule.destinationPort}`;
  if (rule.kind === 'dynamic') return `SOCKS5 proxy on ${listen}`;
  if (rule.kind === 'local') return `${listen} (this PC) → ${target} (from server)`;
  return `${listen} (server) → ${target} (this PC)`;
}
