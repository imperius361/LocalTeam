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
        type: 'discussion',
        content,
        timestamp: Date.now(),
        taskId,
      };

      this.messageBus.emit(message);
      yield message;
    }
  }
}
