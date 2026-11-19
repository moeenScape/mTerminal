export const AGENT_STATUS = 'agent:status';

export interface AgentKey {
  type: string;
  comment: string;
  fingerprint: string;
}
export type AgentStatus =
  | { available: true; source: 'socket' | 'pageant' | 'pipe'; keys: AgentKey[] }
  | { available: false; reason: 'missing' | 'unreachable' };

export interface AgentApi {
  getAgentStatus: () => Promise<AgentStatus>;
}
