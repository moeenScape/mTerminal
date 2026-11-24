import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { LIVE_BATCH, type LiveRelayAction } from '../../../packages/shared/live-share.ts';
import type { SyncEnvelope } from '../../../packages/shared/workspace-sync.ts';
import { AccountFailure } from './account-failure.ts';
import { requireVaultAccess } from './vault-access.ts';

const TIMEOUT = 15_000;
const DURATION = 30 * 60_000;
const BUFFERED_FRAMES = 32;
interface Room {
  organizationId: string;
  vaultId: string;
  host: string;
  sessionId: string;
  guest: string;
  deadline: number;
  lastHost: number;
  latest: number;
  timer?: ReturnType<typeof setTimeout>;
  frames: { sequence: number; frame: SyncEnvelope }[];
}

export class LiveRelay {
  // shortcut: rooms live on one server process; add a shared relay before running multiple instances.
  private readonly rooms = new Map<string, Room>();

  private close(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    clearTimeout(room.timer);
    this.rooms.delete(id);
  }

  private heartbeat(id: string, room: Room): void {
    clearTimeout(room.timer);
    room.lastHost = Date.now();
    const delay = Math.min(TIMEOUT, room.deadline - room.lastHost);
    room.timer = setTimeout(() => this.close(id), delay).unref();
  }

  async handle(client: PoolClient, accountId: string, sessionId: string, action: LiveRelayAction) {
    if (action.kind === 'start') {
      const { organizationId, vaultId, email } = action;
      if ((await requireVaultAccess(client, accountId, organizationId, vaultId)) === 'reader')
        throw new AccountFailure('organization-vault-denied');
      const target = await client.query<{ id: string }>(
        `SELECT a.id FROM accounts a JOIN organization_members m ON m.account_id = a.id
         WHERE m.organization_id = $1 AND a.email = $2`,
        [organizationId, email],
      );
      const guest = target.rows[0]?.id;
      if (!guest || guest === accountId) throw new AccountFailure('live-unavailable');
      await requireVaultAccess(client, guest, organizationId, vaultId);
      if (this.rooms.size >= 20 || [...this.rooms.values()].some((room) => room.host === accountId))
        throw new AccountFailure('live-limit');
      const id = randomUUID();
      const now = Date.now();
      const room: Room = {
        organizationId,
        vaultId,
        host: accountId,
        sessionId,
        guest,
        deadline: now + DURATION,
        lastHost: now,
        latest: 0,
        frames: [],
      };
      this.rooms.set(id, room);
      this.heartbeat(id, room);
      return { room: id };
    }

    const room = this.rooms.get(action.room);
    if (!room) throw new AccountFailure('live-unavailable');
    const hosting = room.host === accountId && room.sessionId === sessionId;
    if (action.kind === 'stop') {
      if (!hosting) throw new AccountFailure('live-unavailable');
      this.close(action.room);
      return {};
    }
    if (action.kind === 'push' ? !hosting : room.guest !== accountId)
      throw new AccountFailure('live-unavailable');

    try {
      const activeHost = await client.query(
        'SELECT 1 FROM account_sessions WHERE id = $1 AND account_id = $2 AND expires_at > clock_timestamp()',
        [room.sessionId, room.host],
      );
      if (
        !activeHost.rowCount ||
        (await requireVaultAccess(client, room.host, room.organizationId, room.vaultId)) ===
          'reader'
      )
        throw new AccountFailure('live-unavailable');
      await requireVaultAccess(client, room.guest, room.organizationId, room.vaultId);
    } catch (error) {
      if (error instanceof AccountFailure) this.close(action.room);
      throw error;
    }
    if (
      this.rooms.get(action.room) !== room ||
      room.deadline <= Date.now() ||
      room.lastHost + TIMEOUT <= Date.now()
    )
      throw new AccountFailure('live-unavailable');

    if (action.kind === 'push') {
      if (action.frame) {
        if (action.sequence !== room.latest + 1) throw new AccountFailure('live-gap');
        room.frames.push({ sequence: ++room.latest, frame: action.frame });
        if (room.frames.length > BUFFERED_FRAMES) room.frames.shift();
      }
      this.heartbeat(action.room, room);
      return { sequence: room.latest };
    }
    const first = room.frames[0]?.sequence ?? 1;
    if (action.after > room.latest || (action.after !== 0 && action.after < first - 1))
      throw new AccountFailure('live-gap');
    return {
      frames: room.frames.filter(({ sequence }) => sequence > action.after).slice(0, LIVE_BATCH),
    };
  }
}
