import { EventEmitter } from 'node:events';
import type { AgentMessage } from './types.js';

export class MessageBus {
  private emitter = new EventEmitter();
  private history: AgentMessage[] = [];

  emit(message: AgentMessage): void {
    this.history.push(message);
    this.emitter.emit('message', message);
    this.emitter.emit(`message:${message.type}`, message);
    this.emitter.emit(`agent:${message.agentId}`, message);
  }

  on(event: string, handler: (msg: AgentMessage) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (msg: AgentMessage) => void): void {
    this.emitter.off(event, handler);
  }

  getHistory(taskId?: string): AgentMessage[] {
    if (taskId) {
      return this.history.filter((m) => m.taskId === taskId);
    }
    return [...this.history];
  }
}
