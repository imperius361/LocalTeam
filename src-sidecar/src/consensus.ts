import type { ConsensusConfig } from './types.js';

export interface AgentPosition {
  agentId: string;
  position: string;
  agrees: boolean;
}

export type ConsensusResult =
  | { status: 'reached'; supporters: string[] }
  | { status: 'no_consensus' };

export class ConsensusProtocol {
  private positions = new Map<string, AgentPosition>();
  private round = 0;

  constructor(private config: ConsensusConfig) {}

  get currentRound(): number {
    return this.round;
  }

  recordPosition(agentId: string, response: string): void {
    const agrees = response.trimStart().startsWith('AGREE');
    this.positions.set(agentId, {
      agentId,
      position: response,
      agrees,
    });
  }

  evaluate(agentIds: string[]): ConsensusResult {
    const totalAgents = agentIds.length;
    const supporters = agentIds.filter(
      (id) => this.positions.get(id)?.agrees === true,
    );

    if (supporters.length / totalAgents >= this.config.requiredMajority) {
      return { status: 'reached', supporters };
    }

    return { status: 'no_consensus' };
  }

  nextRound(): void {
    this.round++;
  }

  shouldEscalate(): boolean {
    return this.round >= this.config.maxRounds;
  }

  getEscalationSummary(): AgentPosition[] {
    return Array.from(this.positions.values());
  }

  reset(): void {
    this.positions.clear();
    this.round = 0;
  }
}
