import { randomUUID } from 'node:crypto';
import type { Agent } from './agent.js';
import type { MessageBus } from './message-bus.js';
import type { AgentMessage } from './types.js';

export interface StreamDeltaEvent {
  messageId: string;
  taskId: string;
  agentId: string;
  agentRole: string;
  round: number;
  delta: string;
  content: string;
  timestamp: number;
}

export interface MessageFinalizedEvent {
  message: AgentMessage;
}

export interface MessageErrorEvent {
  messageId: string;
  taskId: string;
  agentId: string;
  agentRole: string;
  round: number;
  content: string;
  timestamp: number;
  error: unknown;
}

export interface RunRoundOptions {
  agentIds?: string[];
  onStreamDelta?: (event: StreamDeltaEvent) => Promise<void> | void;
  onMessageFinalized?: (event: MessageFinalizedEvent) => Promise<void> | void;
  onMessageError?: (event: MessageErrorEvent) => Promise<void> | void;
  decorateMessage?: (message: AgentMessage, agent: Agent) => AgentMessage;
}

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

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  async *runRound(
    taskId: string,
    prompt: string,
    round = 1,
    options: RunRoundOptions = {},
  ): AsyncGenerator<AgentMessage> {
    const selectedAgents =
      options.agentIds && options.agentIds.length > 0
        ? options.agentIds
            .map((agentId) => this.agents.get(agentId))
            .filter((agent): agent is Agent => Boolean(agent))
        : Array.from(this.agents.values());

    for (const agent of selectedAgents) {
      const messageId = randomUUID();
      let content = '';
      try {
        for await (const token of agent.respond(prompt)) {
          content += token;
          if (options.onStreamDelta) {
            await options.onStreamDelta({
              messageId,
              taskId,
              agentId: agent.id,
              agentRole: agent.role,
              round,
              delta: token,
              content,
              timestamp: Date.now(),
            });
          }
        }
      } catch (error) {
        if (options.onMessageError) {
          await options.onMessageError({
            messageId,
            taskId,
            agentId: agent.id,
            agentRole: agent.role,
            round,
            content,
            timestamp: Date.now(),
            error,
          });
        }
        throw error;
      }

      const baseMessage: AgentMessage = {
        id: messageId,
        agentId: agent.id,
        agentRole: agent.role,
        type: classifyAgentMessage(content),
        content,
        timestamp: Date.now(),
        taskId,
        round,
        tokenEstimate: estimateTokens(content),
      };
      const message = options.decorateMessage
        ? options.decorateMessage(baseMessage, agent)
        : baseMessage;

      this.messageBus.emit(message);
      if (options.onMessageFinalized) {
        await options.onMessageFinalized({ message });
      }
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
