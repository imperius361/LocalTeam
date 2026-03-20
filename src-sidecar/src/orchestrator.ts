import { randomUUID } from 'node:crypto';
import type { Agent } from './agent.js';
import type { MessageBus } from './message-bus.js';
import type { AgentMessage } from './types.js';

export class Orchestrator {
  private agents = new Map<string, Agent>();

  constructor(private messageBus: MessageBus) {}

  addAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  async *runRound(
    taskId: string,
    prompt: string,
    round = 1,
  ): AsyncGenerator<AgentMessage> {
    for (const [, agent] of this.agents) {
      let content = '';
      for await (const token of agent.respond(prompt)) {
        content += token;
      }

      const message: AgentMessage = {
        id: randomUUID(),
        agentId: agent.id,
        agentRole: agent.role,
        type: classifyAgentMessage(content),
        content,
        timestamp: Date.now(),
        taskId,
        round,
        tokenEstimate: estimateTokens(content),
      };

      this.messageBus.emit(message);
      yield message;
    }
  }
}

function classifyAgentMessage(content: string): AgentMessage['type'] {
  const normalized = content.trimStart().toUpperCase();
  if (normalized.startsWith('AGREE')) {
    return 'consensus';
  }
  if (normalized.startsWith('OBJECTION')) {
    return 'objection';
  }
  if (normalized.startsWith('PROPOSAL')) {
    return 'proposal';
  }
  return 'discussion';
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}
