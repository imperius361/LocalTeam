# Agent Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TypeScript agent orchestration engine that integrates Claude and OpenAI SDKs, routes messages between agents, manages consensus, and handles task lifecycle.

**Architecture:** The Agent Core lives in `src-sidecar/src/` and extends the existing sidecar process. It adds an LLM provider abstraction (Anthropic + OpenAI), an Agent class wrapping provider sessions with role context, a MessageBus for event routing, an Orchestrator managing agent turns in round-robin, a ConsensusProtocol for detecting agreement/escalation, and a TaskManager for task lifecycle. All components communicate through the existing JSON-line IPC protocol, extended with push notifications for streaming events.

**Tech Stack:** TypeScript, Node.js, `@anthropic-ai/sdk`, `openai`, vitest, existing Tauri sidecar infrastructure

---

## File Structure

```
src-sidecar/src/
├── types.ts                    # Core type definitions (AgentConfig, ChatMessage, AgentMessage, etc.)
├── providers/
│   ├── types.ts               # LlmProvider interface
│   ├── mock.ts                # Mock provider for testing
│   ├── anthropic.ts           # Claude SDK wrapper
│   └── openai.ts              # OpenAI SDK wrapper
├── message-bus.ts             # Event-based message routing
├── agent.ts                   # Agent class (provider session + role context + history)
├── orchestrator.ts            # Coordinates agents, round-robin turns, session management
├── consensus.ts               # Consensus protocol (rounds, convergence, escalation)
├── task-manager.ts            # Task lifecycle (pending → in_progress → review → completed)
├── team-config.ts             # Load/validate team configurations
├── handlers.ts                # (existing — extend with orchestrator commands)
├── protocol.ts                # (existing — extend with IpcNotification type)
└── index.ts                   # (existing)

src-sidecar/tests/
├── providers/
│   ├── mock.test.ts
│   ├── anthropic.test.ts
│   └── openai.test.ts
├── message-bus.test.ts
├── agent.test.ts
├── orchestrator.test.ts
├── consensus.test.ts
├── task-manager.test.ts
├── team-config.test.ts
├── handlers.test.ts           # (existing — extend)
└── protocol.test.ts           # (existing)

tests/e2e/
└── orchestrator.test.ts       # E2E: full orchestration flow with mock provider
```

---

### Task 1: Core Types & Provider Interface

**Files:**
- Create: `src-sidecar/src/types.ts`
- Create: `src-sidecar/src/providers/types.ts`

- [ ] **Step 1: Create core type definitions**

Create `src-sidecar/src/types.ts`:

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentConfig {
  id: string;
  role: string;
  model: string;
  provider: 'anthropic' | 'openai';
  systemPrompt: string;
  tools?: string[];
  allowedPaths?: string[];
  canExecuteCommands?: boolean;
}

export interface AgentMessage {
  id: string;
  agentId: string;
  agentRole: string;
  type: 'discussion' | 'proposal' | 'objection' | 'consensus' | 'artifact';
  content: string;
  timestamp: number;
  taskId?: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedAgents: string[];
  parentTaskId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConsensusConfig {
  maxRounds: number;
  requiredMajority: number;
}

export interface TeamConfig {
  name: string;
  agents: AgentConfig[];
  consensus: ConsensusConfig;
}
```

- [ ] **Step 2: Create provider interface**

Create `src-sidecar/src/providers/types.ts`:

```typescript
import type { ChatMessage } from '../types.js';

export interface SendMessageParams {
  messages: ChatMessage[];
  systemPrompt: string;
  model: string;
}

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  sendMessage(params: SendMessageParams): AsyncGenerator<string>;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd src-sidecar && npx tsc --noEmit src/types.ts src/providers/types.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-sidecar/src/types.ts src-sidecar/src/providers/types.ts
git commit -m "feat: add core types and LLM provider interface for agent core"
```

---

### Task 2: Mock Provider

**Files:**
- Create: `src-sidecar/src/providers/mock.ts`
- Create: `src-sidecar/tests/providers/mock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/providers/mock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MockProvider } from '../src/providers/mock';

describe('MockProvider', () => {
  it('has correct id and name', () => {
    const provider = new MockProvider();
    expect(provider.id).toBe('mock');
    expect(provider.name).toBe('Mock');
  });

  it('yields the default response when none configured', async () => {
    const provider = new MockProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'test',
      model: 'mock',
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('Mock response');
  });

  it('cycles through configured responses', async () => {
    const provider = new MockProvider(['First reply', 'Second reply']);
    const results: string[] = [];

    for (let i = 0; i < 3; i++) {
      let full = '';
      for await (const chunk of provider.sendMessage({
        messages: [{ role: 'user', content: 'Hi' }],
        systemPrompt: 'test',
        model: 'mock',
      })) {
        full += chunk;
      }
      results.push(full);
    }

    expect(results).toEqual(['First reply', 'Second reply', 'First reply']);
  });

  it('records call history', async () => {
    const provider = new MockProvider();
    const params = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      systemPrompt: 'Be helpful',
      model: 'mock-model',
    };

    // Consume the generator
    for await (const _ of provider.sendMessage(params)) { /* drain */ }

    expect(provider.callHistory).toHaveLength(1);
    expect(provider.callHistory[0].systemPrompt).toBe('Be helpful');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/providers/mock.test.ts`
Expected: FAIL — cannot find module `../src/providers/mock`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/providers/mock.ts`:

```typescript
import type { LlmProvider, SendMessageParams } from './types.js';

export class MockProvider implements LlmProvider {
  readonly id = 'mock';
  readonly name = 'Mock';

  private responses: string[];
  private callIndex = 0;
  readonly callHistory: SendMessageParams[] = [];

  constructor(responses: string[] = ['Mock response']) {
    this.responses = responses;
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<string> {
    this.callHistory.push({ ...params });
    const response = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;
    yield response;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/providers/mock.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/providers/mock.ts src-sidecar/tests/providers/mock.test.ts
git commit -m "feat: add mock LLM provider for testing"
```

---

### Task 3: Anthropic Provider

**Files:**
- Create: `src-sidecar/src/providers/anthropic.ts`
- Create: `src-sidecar/tests/providers/anthropic.test.ts`
- Modify: `src-sidecar/package.json` (add dependency)

- [ ] **Step 1: Install the Anthropic SDK**

Run: `cd src-sidecar && npm install @anthropic-ai/sdk`

- [ ] **Step 2: Write the failing test**

Create `src-sidecar/tests/providers/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic';

function createMockStream(textChunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of textChunks) {
        yield {
          type: 'content_block_delta' as const,
          index: 0,
          delta: { type: 'text_delta' as const, text },
        };
      }
    },
  };
}

function createMockClient(textChunks: string[]) {
  return {
    messages: {
      stream: vi.fn().mockReturnValue(createMockStream(textChunks)),
    },
  };
}

describe('AnthropicProvider', () => {
  it('has correct id and name', () => {
    const provider = new AnthropicProvider(createMockClient([]) as any);
    expect(provider.id).toBe('anthropic');
    expect(provider.name).toBe('Anthropic');
  });

  it('streams text chunks from the Claude API', async () => {
    const mockClient = createMockClient(['Hello', ' world', '!']);
    const provider = new AnthropicProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'You are helpful',
      model: 'claude-sonnet-4-20250514',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('passes correct parameters to the SDK', async () => {
    const mockClient = createMockClient(['OK']);
    const provider = new AnthropicProvider(mockClient as any);

    // Drain the generator
    for await (const _ of provider.sendMessage({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
      systemPrompt: 'Be concise',
      model: 'claude-opus-4-20250514',
    })) { /* drain */ }

    expect(mockClient.messages.stream).toHaveBeenCalledWith({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      system: 'Be concise',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
    });
  });

  it('ignores non-text-delta events', async () => {
    const mockClient = {
      messages: {
        stream: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_start', message: {} };
            yield {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Hello' },
            };
            yield { type: 'message_stop' };
          },
        }),
      },
    };
    const provider = new AnthropicProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'test',
      model: 'claude-sonnet-4-20250514',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/providers/anthropic.test.ts`
Expected: FAIL — cannot find module `../src/providers/anthropic`

- [ ] **Step 4: Write minimal implementation**

Create `src-sidecar/src/providers/anthropic.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, SendMessageParams } from './types.js';

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';

  constructor(private client: Anthropic) {}

  async *sendMessage(params: SendMessageParams): AsyncGenerator<string> {
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/providers/anthropic.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src-sidecar/src/providers/anthropic.ts src-sidecar/tests/providers/anthropic.test.ts src-sidecar/package.json src-sidecar/package-lock.json
git commit -m "feat: add Anthropic provider wrapping Claude SDK"
```

---

### Task 4: OpenAI Provider

**Files:**
- Create: `src-sidecar/src/providers/openai.ts`
- Create: `src-sidecar/tests/providers/openai.test.ts`
- Modify: `src-sidecar/package.json` (add dependency)

- [ ] **Step 1: Install the OpenAI SDK**

Run: `cd src-sidecar && npm install openai`

- [ ] **Step 2: Write the failing test**

Create `src-sidecar/tests/providers/openai.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai';

function createMockStream(textChunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of textChunks) {
        yield {
          choices: [{ delta: { content }, index: 0, finish_reason: null }],
        };
      }
    },
  };
}

function createMockClient(textChunks: string[]) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(createMockStream(textChunks)),
      },
    },
  };
}

describe('OpenAIProvider', () => {
  it('has correct id and name', () => {
    const provider = new OpenAIProvider(createMockClient([]) as any);
    expect(provider.id).toBe('openai');
    expect(provider.name).toBe('OpenAI');
  });

  it('streams text chunks from the OpenAI API', async () => {
    const mockClient = createMockClient(['Hello', ' world', '!']);
    const provider = new OpenAIProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'You are helpful',
      model: 'gpt-4o',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('passes correct parameters to the SDK', async () => {
    const mockClient = createMockClient(['OK']);
    const provider = new OpenAIProvider(mockClient as any);

    for await (const _ of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hello' }],
      systemPrompt: 'Be concise',
      model: 'gpt-4o',
    })) { /* drain */ }

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hello' },
      ],
    });
  });

  it('skips chunks with null content', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: 'Hi' }, index: 0 }] };
              yield { choices: [{ delta: { content: null }, index: 0 }] };
              yield { choices: [{ delta: {}, index: 0 }] };
              yield { choices: [{ delta: { content: '!' }, index: 0 }] };
            },
          }),
        },
      },
    };
    const provider = new OpenAIProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'test',
      model: 'gpt-4o',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hi', '!']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/providers/openai.test.ts`
Expected: FAIL — cannot find module `../src/providers/openai`

- [ ] **Step 4: Write minimal implementation**

Create `src-sidecar/src/providers/openai.ts`:

```typescript
import type OpenAI from 'openai';
import type { LlmProvider, SendMessageParams } from './types.js';

export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  constructor(private client: OpenAI) {}

  async *sendMessage(params: SendMessageParams): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: params.model,
      stream: true,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/providers/openai.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src-sidecar/src/providers/openai.ts src-sidecar/tests/providers/openai.test.ts src-sidecar/package.json src-sidecar/package-lock.json
git commit -m "feat: add OpenAI provider wrapping GPT SDK"
```

---

### Task 5: Message Bus

**Files:**
- Create: `src-sidecar/src/message-bus.ts`
- Create: `src-sidecar/tests/message-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/message-bus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MessageBus } from '../src/message-bus';
import type { AgentMessage } from '../src/types';

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    agentId: 'agent-1',
    agentRole: 'Architect',
    type: 'discussion',
    content: 'Test message',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MessageBus', () => {
  it('delivers messages to subscribers', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.on('message', handler);

    const msg = makeMessage();
    bus.emit(msg);

    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('delivers messages filtered by type', () => {
    const bus = new MessageBus();
    const proposalHandler = vi.fn();
    const discussionHandler = vi.fn();
    bus.on('message:proposal', proposalHandler);
    bus.on('message:discussion', discussionHandler);

    bus.emit(makeMessage({ type: 'proposal' }));

    expect(proposalHandler).toHaveBeenCalledTimes(1);
    expect(discussionHandler).not.toHaveBeenCalled();
  });

  it('delivers messages filtered by agent', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.on('agent:agent-2', handler);

    bus.emit(makeMessage({ agentId: 'agent-1' }));
    bus.emit(makeMessage({ agentId: 'agent-2' }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports unsubscribing', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.on('message', handler);
    bus.off('message', handler);

    bus.emit(makeMessage());

    expect(handler).not.toHaveBeenCalled();
  });

  it('collects all messages in history', () => {
    const bus = new MessageBus();
    const msg1 = makeMessage({ id: 'a' });
    const msg2 = makeMessage({ id: 'b' });
    bus.emit(msg1);
    bus.emit(msg2);

    expect(bus.getHistory()).toEqual([msg1, msg2]);
  });

  it('filters history by taskId', () => {
    const bus = new MessageBus();
    bus.emit(makeMessage({ id: 'a', taskId: 'task-1' }));
    bus.emit(makeMessage({ id: 'b', taskId: 'task-2' }));
    bus.emit(makeMessage({ id: 'c', taskId: 'task-1' }));

    const filtered = bus.getHistory('task-1');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.id)).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/message-bus.test.ts`
Expected: FAIL — cannot find module `../src/message-bus`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/message-bus.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/message-bus.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/message-bus.ts src-sidecar/tests/message-bus.test.ts
git commit -m "feat: add message bus for inter-agent event routing"
```

---

### Task 6: Agent Class

**Files:**
- Create: `src-sidecar/src/agent.ts`
- Create: `src-sidecar/tests/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/agent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/agent';
import { MockProvider } from '../src/providers/mock';
import type { AgentConfig } from '../src/types';

const testConfig: AgentConfig = {
  id: 'architect',
  role: 'Software Architect',
  model: 'mock-model',
  provider: 'anthropic',
  systemPrompt: 'You are a senior software architect.',
};

describe('Agent', () => {
  it('exposes config properties', () => {
    const provider = new MockProvider();
    const agent = new Agent(testConfig, provider);

    expect(agent.id).toBe('architect');
    expect(agent.role).toBe('Software Architect');
    expect(agent.model).toBe('mock-model');
  });

  it('responds by streaming from the provider', async () => {
    const provider = new MockProvider(['I suggest using microservices.']);
    const agent = new Agent(testConfig, provider);

    let fullResponse = '';
    for await (const chunk of agent.respond('What architecture should we use?')) {
      fullResponse += chunk;
    }

    expect(fullResponse).toBe('I suggest using microservices.');
  });

  it('maintains conversation history', async () => {
    const provider = new MockProvider(['Reply 1', 'Reply 2']);
    const agent = new Agent(testConfig, provider);

    // First exchange
    for await (const _ of agent.respond('First question')) { /* drain */ }

    // Second exchange
    for await (const _ of agent.respond('Second question')) { /* drain */ }

    const history = agent.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', content: 'First question' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'Reply 1' });
    expect(history[2]).toEqual({ role: 'user', content: 'Second question' });
    expect(history[3]).toEqual({ role: 'assistant', content: 'Reply 2' });
  });

  it('passes system prompt and history to the provider', async () => {
    const provider = new MockProvider(['OK']);
    const agent = new Agent(testConfig, provider);

    for await (const _ of agent.respond('Hello')) { /* drain */ }

    expect(provider.callHistory).toHaveLength(1);
    expect(provider.callHistory[0].systemPrompt).toBe(
      'You are a senior software architect.',
    );
    expect(provider.callHistory[0].messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('resets history when reset() is called', async () => {
    const provider = new MockProvider(['Reply']);
    const agent = new Agent(testConfig, provider);

    for await (const _ of agent.respond('Hello')) { /* drain */ }
    expect(agent.getHistory()).toHaveLength(2);

    agent.reset();
    expect(agent.getHistory()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/agent.test.ts`
Expected: FAIL — cannot find module `../src/agent`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/agent.ts`:

```typescript
import type { AgentConfig, ChatMessage } from './types.js';
import type { LlmProvider } from './providers/types.js';

export class Agent {
  readonly id: string;
  readonly role: string;
  readonly model: string;

  private provider: LlmProvider;
  private systemPrompt: string;
  private history: ChatMessage[] = [];

  constructor(config: AgentConfig, provider: LlmProvider) {
    this.id = config.id;
    this.role = config.role;
    this.model = config.model;
    this.provider = provider;
    this.systemPrompt = config.systemPrompt;
  }

  async *respond(input: string): AsyncGenerator<string> {
    this.history.push({ role: 'user', content: input });

    let fullResponse = '';
    for await (const token of this.provider.sendMessage({
      messages: [...this.history],
      systemPrompt: this.systemPrompt,
      model: this.model,
    })) {
      fullResponse += token;
      yield token;
    }

    this.history.push({ role: 'assistant', content: fullResponse });
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  reset(): void {
    this.history = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/agent.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/agent.ts src-sidecar/tests/agent.test.ts
git commit -m "feat: add Agent class wrapping LLM provider with conversation history"
```

---

### Task 7: Orchestrator

**Files:**
- Create: `src-sidecar/src/orchestrator.ts`
- Create: `src-sidecar/tests/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/orchestrator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/orchestrator';
import { Agent } from '../src/agent';
import { MessageBus } from '../src/message-bus';
import { MockProvider } from '../src/providers/mock';
import type { AgentConfig, AgentMessage } from '../src/types';

function makeAgent(id: string, role: string, responses: string[]): Agent {
  const config: AgentConfig = {
    id,
    role,
    model: 'mock',
    provider: 'anthropic',
    systemPrompt: `You are a ${role}.`,
  };
  return new Agent(config, new MockProvider(responses));
}

describe('Orchestrator', () => {
  it('runs a round-robin discussion round', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('arch', 'Architect', ['Use microservices']));
    orchestrator.addAgent(makeAgent('eng', 'Engineer', ['Prefer monolith']));

    const messages: AgentMessage[] = [];
    for await (const msg of orchestrator.runRound('task-1', 'What architecture?')) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0].agentId).toBe('arch');
    expect(messages[0].content).toBe('Use microservices');
    expect(messages[0].type).toBe('discussion');
    expect(messages[0].taskId).toBe('task-1');
    expect(messages[1].agentId).toBe('eng');
    expect(messages[1].content).toBe('Prefer monolith');
  });

  it('includes all agent messages in the message bus', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('a', 'Role A', ['Reply A']));
    orchestrator.addAgent(makeAgent('b', 'Role B', ['Reply B']));

    for await (const _ of orchestrator.runRound('task-1', 'Discuss')) { /* drain */ }

    const history = bus.getHistory('task-1');
    expect(history).toHaveLength(2);
  });

  it('passes prior round context to each agent', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    const providerA = new MockProvider(['Round 1 from A', 'Round 2 from A']);
    const providerB = new MockProvider(['Round 1 from B', 'Round 2 from B']);

    const configA: AgentConfig = {
      id: 'a', role: 'A', model: 'mock', provider: 'anthropic',
      systemPrompt: 'You are A.',
    };
    const configB: AgentConfig = {
      id: 'b', role: 'B', model: 'mock', provider: 'anthropic',
      systemPrompt: 'You are B.',
    };

    orchestrator.addAgent(new Agent(configA, providerA));
    orchestrator.addAgent(new Agent(configB, providerB));

    // Run two rounds
    for await (const _ of orchestrator.runRound('task-1', 'Topic')) { /* drain */ }
    for await (const _ of orchestrator.runRound('task-1', 'Continue discussion')) { /* drain */ }

    // Agent A should have 2 calls (one per round)
    expect(providerA.callHistory).toHaveLength(2);
    // Second call should have the first exchange in history
    expect(providerA.callHistory[1].messages.length).toBeGreaterThan(1);
  });

  it('returns agent list', () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('a', 'Role A', ['x']));
    orchestrator.addAgent(makeAgent('b', 'Role B', ['y']));

    const agents = orchestrator.getAgents();
    expect(agents.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('removes an agent', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('a', 'Role A', ['x']));
    orchestrator.addAgent(makeAgent('b', 'Role B', ['y']));
    orchestrator.removeAgent('a');

    const messages: AgentMessage[] = [];
    for await (const msg of orchestrator.runRound('task-1', 'Discuss')) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].agentId).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/orchestrator.test.ts`
Expected: FAIL — cannot find module `../src/orchestrator`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/orchestrator.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/orchestrator.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/orchestrator.ts src-sidecar/tests/orchestrator.test.ts
git commit -m "feat: add orchestrator for round-robin agent coordination"
```

---

### Task 8: Consensus Protocol

**Files:**
- Create: `src-sidecar/src/consensus.ts`
- Create: `src-sidecar/tests/consensus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/consensus.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ConsensusProtocol } from '../src/consensus';
import type { AgentMessage, ConsensusConfig } from '../src/types';

const defaultConfig: ConsensusConfig = {
  maxRounds: 3,
  requiredMajority: 0.66,
};

function makeMessage(
  agentId: string,
  content: string,
  type: AgentMessage['type'] = 'discussion',
): AgentMessage {
  return {
    id: `msg-${agentId}`,
    agentId,
    agentRole: 'Role',
    type,
    content,
    timestamp: Date.now(),
    taskId: 'task-1',
  };
}

describe('ConsensusProtocol', () => {
  it('detects unanimous agreement', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: microservices is the way');
    protocol.recordPosition('agent-2', 'AGREE: microservices sounds right');
    protocol.recordPosition('agent-3', 'AGREE: let us go with microservices');

    const result = protocol.evaluate(['agent-1', 'agent-2', 'agent-3']);

    expect(result.status).toBe('reached');
    if (result.status === 'reached') {
      expect(result.supporters).toEqual(['agent-1', 'agent-2', 'agent-3']);
    }
  });

  it('detects supermajority agreement', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: option A');
    protocol.recordPosition('agent-2', 'AGREE: option A');
    protocol.recordPosition('agent-3', 'DISAGREE: I prefer option B');

    const result = protocol.evaluate(['agent-1', 'agent-2', 'agent-3']);

    expect(result.status).toBe('reached');
    if (result.status === 'reached') {
      expect(result.supporters).toEqual(['agent-1', 'agent-2']);
    }
  });

  it('does not reach consensus without supermajority', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: option A');
    protocol.recordPosition('agent-2', 'DISAGREE: prefer B');
    protocol.recordPosition('agent-3', 'DISAGREE: prefer C');

    const result = protocol.evaluate(['agent-1', 'agent-2', 'agent-3']);

    expect(result.status).toBe('no_consensus');
  });

  it('tracks round count', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    expect(protocol.currentRound).toBe(0);
    protocol.nextRound();
    expect(protocol.currentRound).toBe(1);
    protocol.nextRound();
    expect(protocol.currentRound).toBe(2);
  });

  it('detects when max rounds exceeded', () => {
    const config: ConsensusConfig = { maxRounds: 2, requiredMajority: 0.66 };
    const protocol = new ConsensusProtocol(config);

    protocol.nextRound();
    expect(protocol.shouldEscalate()).toBe(false);

    protocol.nextRound();
    expect(protocol.shouldEscalate()).toBe(true);
  });

  it('generates escalation summary', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: option A because performance');
    protocol.recordPosition('agent-2', 'DISAGREE: option B because simplicity');

    const summary = protocol.getEscalationSummary();

    expect(summary).toHaveLength(2);
    expect(summary[0].agentId).toBe('agent-1');
    expect(summary[0].position).toContain('option A');
    expect(summary[0].agrees).toBe(true);
    expect(summary[1].agentId).toBe('agent-2');
    expect(summary[1].agrees).toBe(false);
  });

  it('resets state for new consensus', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: something');
    protocol.nextRound();
    protocol.reset();

    expect(protocol.currentRound).toBe(0);
    expect(protocol.getEscalationSummary()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/consensus.test.ts`
Expected: FAIL — cannot find module `../src/consensus`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/consensus.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/consensus.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/consensus.ts src-sidecar/tests/consensus.test.ts
git commit -m "feat: add consensus protocol with round tracking and escalation"
```

---

### Task 9: Task Manager

**Files:**
- Create: `src-sidecar/src/task-manager.ts`
- Create: `src-sidecar/tests/task-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/task-manager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TaskManager } from '../src/task-manager';

describe('TaskManager', () => {
  it('creates a task with pending status', () => {
    const manager = new TaskManager();
    const task = manager.create('Build auth', 'Implement OAuth2 login');

    expect(task.title).toBe('Build auth');
    expect(task.description).toBe('Implement OAuth2 login');
    expect(task.status).toBe('pending');
    expect(task.id).toBeTruthy();
    expect(task.assignedAgents).toEqual([]);
  });

  it('retrieves a task by id', () => {
    const manager = new TaskManager();
    const task = manager.create('Task 1', 'Description 1');

    const found = manager.get(task.id);
    expect(found).toEqual(task);
  });

  it('returns undefined for unknown task id', () => {
    const manager = new TaskManager();
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('transitions task through valid states', () => {
    const manager = new TaskManager();
    const task = manager.create('Task', 'Desc');

    manager.transition(task.id, 'in_progress');
    expect(manager.get(task.id)!.status).toBe('in_progress');

    manager.transition(task.id, 'review');
    expect(manager.get(task.id)!.status).toBe('review');

    manager.transition(task.id, 'completed');
    expect(manager.get(task.id)!.status).toBe('completed');
  });

  it('rejects invalid state transitions', () => {
    const manager = new TaskManager();
    const task = manager.create('Task', 'Desc');

    // Cannot go from pending directly to completed
    expect(() => manager.transition(task.id, 'completed')).toThrow(
      'Invalid transition',
    );
  });

  it('assigns agents to a task', () => {
    const manager = new TaskManager();
    const task = manager.create('Task', 'Desc');

    manager.assign(task.id, ['architect', 'engineer']);
    expect(manager.get(task.id)!.assignedAgents).toEqual([
      'architect',
      'engineer',
    ]);
  });

  it('creates subtasks linked to a parent', () => {
    const manager = new TaskManager();
    const parent = manager.create('Parent', 'Parent desc');
    const child = manager.createSubtask(parent.id, 'Child', 'Child desc');

    expect(child.parentTaskId).toBe(parent.id);
  });

  it('lists all tasks', () => {
    const manager = new TaskManager();
    manager.create('A', 'a');
    manager.create('B', 'b');

    expect(manager.list()).toHaveLength(2);
  });

  it('lists tasks filtered by status', () => {
    const manager = new TaskManager();
    const t1 = manager.create('A', 'a');
    manager.create('B', 'b');
    manager.transition(t1.id, 'in_progress');

    expect(manager.list('in_progress')).toHaveLength(1);
    expect(manager.list('pending')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/task-manager.test.ts`
Expected: FAIL — cannot find module `../src/task-manager`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/task-manager.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Task, TaskStatus } from './types.js';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['review', 'completed'],
  review: ['completed', 'in_progress'],
  completed: [],
};

export class TaskManager {
  private tasks = new Map<string, Task>();

  create(title: string, description: string): Task {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      title,
      description,
      status: 'pending',
      assignedAgents: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  createSubtask(parentId: string, title: string, description: string): Task {
    const task = this.create(title, description);
    const stored = this.tasks.get(task.id)!;
    stored.parentTaskId = parentId;
    return { ...stored };
  }

  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  transition(id: string, newStatus: TaskStatus): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${task.status} → ${newStatus}`,
      );
    }

    task.status = newStatus;
    task.updatedAt = Date.now();
  }

  assign(id: string, agentIds: string[]): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.assignedAgents = [...agentIds];
    task.updatedAt = Date.now();
  }

  list(status?: TaskStatus): Task[] {
    const all = Array.from(this.tasks.values());
    if (status) {
      return all.filter((t) => t.status === status).map((t) => ({ ...t }));
    }
    return all.map((t) => ({ ...t }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/task-manager.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/task-manager.ts src-sidecar/tests/task-manager.test.ts
git commit -m "feat: add task manager with state transitions and subtasks"
```

---

### Task 10: Team Configuration

**Files:**
- Create: `src-sidecar/src/team-config.ts`
- Create: `src-sidecar/tests/team-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-sidecar/tests/team-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseTeamConfig, validateTeamConfig } from '../src/team-config';
import type { TeamConfig } from '../src/types';

const validConfig: TeamConfig = {
  name: 'Test Team',
  agents: [
    {
      id: 'architect',
      role: 'Software Architect',
      model: 'claude-opus-4-20250514',
      provider: 'anthropic',
      systemPrompt: 'You are a senior software architect.',
    },
    {
      id: 'engineer',
      role: 'Engineer',
      model: 'gpt-4o',
      provider: 'openai',
      systemPrompt: 'You are a senior software engineer.',
    },
  ],
  consensus: {
    maxRounds: 3,
    requiredMajority: 0.66,
  },
};

describe('parseTeamConfig', () => {
  it('parses valid JSON into a TeamConfig', () => {
    const json = JSON.stringify(validConfig);
    const result = parseTeamConfig(json);
    expect(result).toEqual(validConfig);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseTeamConfig('not json')).toThrow();
  });
});

describe('validateTeamConfig', () => {
  it('accepts a valid config', () => {
    const errors = validateTeamConfig(validConfig);
    expect(errors).toEqual([]);
  });

  it('rejects config with no agents', () => {
    const config = { ...validConfig, agents: [] };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Team must have at least one agent');
  });

  it('rejects config with missing team name', () => {
    const config = { ...validConfig, name: '' };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Team name is required');
  });

  it('rejects agents with duplicate ids', () => {
    const config: TeamConfig = {
      ...validConfig,
      agents: [
        { ...validConfig.agents[0], id: 'same' },
        { ...validConfig.agents[1], id: 'same' },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Duplicate agent id: same');
  });

  it('rejects agents with unsupported provider', () => {
    const config: TeamConfig = {
      ...validConfig,
      agents: [
        { ...validConfig.agents[0], provider: 'unsupported' as any },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors[0]).toContain('Unsupported provider');
  });

  it('rejects invalid consensus config', () => {
    const config: TeamConfig = {
      ...validConfig,
      consensus: { maxRounds: 0, requiredMajority: 1.5 },
    };
    const errors = validateTeamConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects agents missing required fields', () => {
    const config: TeamConfig = {
      ...validConfig,
      agents: [
        { id: '', role: '', model: '', provider: 'anthropic', systemPrompt: '' },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-sidecar && npx vitest run tests/team-config.test.ts`
Expected: FAIL — cannot find module `../src/team-config`

- [ ] **Step 3: Write minimal implementation**

Create `src-sidecar/src/team-config.ts`:

```typescript
import type { TeamConfig } from './types.js';

const SUPPORTED_PROVIDERS = ['anthropic', 'openai'];

export function parseTeamConfig(json: string): TeamConfig {
  return JSON.parse(json) as TeamConfig;
}

export function validateTeamConfig(config: TeamConfig): string[] {
  const errors: string[] = [];

  if (!config.name) {
    errors.push('Team name is required');
  }

  if (!config.agents || config.agents.length === 0) {
    errors.push('Team must have at least one agent');
  }

  // Check for duplicate agent IDs
  const ids = new Set<string>();
  for (const agent of config.agents) {
    if (ids.has(agent.id)) {
      errors.push(`Duplicate agent id: ${agent.id}`);
    }
    ids.add(agent.id);

    if (!agent.id) {
      errors.push('Agent id is required');
    }
    if (!agent.role) {
      errors.push(`Agent ${agent.id || '(unnamed)'}: role is required`);
    }
    if (!agent.model) {
      errors.push(`Agent ${agent.id || '(unnamed)'}: model is required`);
    }
    if (!agent.systemPrompt) {
      errors.push(`Agent ${agent.id || '(unnamed)'}: systemPrompt is required`);
    }
    if (!SUPPORTED_PROVIDERS.includes(agent.provider)) {
      errors.push(
        `Unsupported provider "${agent.provider}" for agent ${agent.id}`,
      );
    }
  }

  // Validate consensus config
  if (config.consensus.maxRounds < 1) {
    errors.push('consensus.maxRounds must be at least 1');
  }
  if (
    config.consensus.requiredMajority <= 0 ||
    config.consensus.requiredMajority > 1
  ) {
    errors.push('consensus.requiredMajority must be between 0 and 1');
  }

  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-sidecar && npx vitest run tests/team-config.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/src/team-config.ts src-sidecar/tests/team-config.test.ts
git commit -m "feat: add team configuration parsing and validation"
```

---

### Task 11: IPC Integration — Protocol Extension & Handler Wiring

**Files:**
- Modify: `src-sidecar/src/protocol.ts` (add IpcNotification type)
- Modify: `src-sidecar/src/handlers.ts` (add orchestrator commands)
- Modify: `src-sidecar/src/index.ts` (initialize orchestrator)
- Modify: `src-sidecar/tests/handlers.test.ts` (add new handler tests)
- Modify: `src/lib/ipc.ts` (handle notifications)

- [ ] **Step 1: Extend protocol with notification type**

Add to `src-sidecar/src/protocol.ts`:

```typescript
export interface IpcNotification {
  method: string;
  params: Record<string, unknown>;
}

export type IpcMessage = IpcRequest | IpcResponse | IpcNotification;

export function emitNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  process.stdout.write(encodeMessage({ method, params }));
}
```

- [ ] **Step 2: Write failing tests for new handlers**

Add to `src-sidecar/tests/handlers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createHandlers } from '../src/handlers';
import { MessageBus } from '../src/message-bus';
import { Orchestrator } from '../src/orchestrator';
import { TaskManager } from '../src/task-manager';

// Keep existing tests, add new describe block:

describe('Orchestrator Handlers', () => {
  function setup() {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);
    const taskManager = new TaskManager();
    const handle = createHandlers(orchestrator, taskManager);
    return { handle, orchestrator, taskManager, bus };
  }

  it('handles create_task', () => {
    const { handle } = setup();
    const res = handle({
      id: '1',
      method: 'create_task',
      params: { title: 'Build auth', description: 'OAuth2 login' },
    });

    expect(res.error).toBeUndefined();
    expect(res.result).toHaveProperty('id');
    expect((res.result as any).title).toBe('Build auth');
    expect((res.result as any).status).toBe('pending');
  });

  it('handles list_tasks', () => {
    const { handle, taskManager } = setup();
    taskManager.create('Task A', 'Desc A');
    taskManager.create('Task B', 'Desc B');

    const res = handle({ id: '1', method: 'list_tasks', params: {} });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(2);
  });

  it('handles get_agents with empty orchestrator', () => {
    const { handle } = setup();
    const res = handle({ id: '1', method: 'get_agents', params: {} });

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-sidecar && npx vitest run tests/handlers.test.ts`
Expected: FAIL — `createHandlers` is not exported from handlers

- [ ] **Step 4: Rewrite handlers to support orchestrator commands**

Replace `src-sidecar/src/handlers.ts` with:

```typescript
import type { IpcRequest, IpcResponse } from './protocol.js';
import type { Orchestrator } from './orchestrator.js';
import type { TaskManager } from './task-manager.js';

const startTime = Date.now();

export function createHandlers(
  orchestrator: Orchestrator,
  taskManager: TaskManager,
): (req: IpcRequest) => IpcResponse {
  return (req: IpcRequest): IpcResponse => {
    switch (req.method) {
      case 'ping':
        return { id: req.id, result: { status: 'pong' } };

      case 'echo':
        return { id: req.id, result: req.params };

      case 'status':
        return {
          id: req.id,
          result: {
            uptime: Date.now() - startTime,
            version: '0.1.0',
          },
        };

      case 'create_task':
        return {
          id: req.id,
          result: taskManager.create(
            req.params.title as string,
            req.params.description as string,
          ),
        };

      case 'list_tasks':
        return {
          id: req.id,
          result: taskManager.list(req.params.status as any),
        };

      case 'get_agents':
        return {
          id: req.id,
          result: orchestrator.getAgents().map((a) => ({
            id: a.id,
            role: a.role,
            model: a.model,
          })),
        };

      default:
        return {
          id: req.id,
          error: { code: -1, message: `Unknown method: ${req.method}` },
        };
    }
  };
}

// Keep backward compatibility — a simple handleRequest using no-op instances
// This will be removed once index.ts is updated
export function handleRequest(req: IpcRequest): IpcResponse {
  // Minimal fallback for existing tests
  switch (req.method) {
    case 'ping':
      return { id: req.id, result: { status: 'pong' } };
    case 'echo':
      return { id: req.id, result: req.params };
    case 'status':
      return {
        id: req.id,
        result: { uptime: Date.now() - startTime, version: '0.1.0' },
      };
    default:
      return {
        id: req.id,
        error: { code: -1, message: `Unknown method: ${req.method}` },
      };
  }
}
```

- [ ] **Step 5: Update index.ts to initialize orchestrator**

Replace `src-sidecar/src/index.ts` with:

```typescript
import { createInterface } from 'node:readline';
import {
  encodeMessage,
  decodeMessage,
  type IpcRequest,
  type IpcResponse,
} from './protocol.js';
import { createHandlers } from './handlers.js';
import { MessageBus } from './message-bus.js';
import { Orchestrator } from './orchestrator.js';
import { TaskManager } from './task-manager.js';

// Initialize core components
const messageBus = new MessageBus();
const orchestrator = new Orchestrator(messageBus);
const taskManager = new TaskManager();
const handleRequest = createHandlers(orchestrator, taskManager);

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const req = decodeMessage(line) as IpcRequest;
    const res = handleRequest(req);
    process.stdout.write(encodeMessage(res));
  } catch (err) {
    const errorRes: IpcResponse = {
      id: 'unknown',
      error: {
        code: -2,
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    };
    process.stdout.write(encodeMessage(errorRes));
  }
});

process.stderr.write('localteam-sidecar started\n');
```

- [ ] **Step 6: Update frontend IPC to handle notifications**

Add notification handling to `src/lib/ipc.ts`. After the existing response handling in the `sidecar-stdout` listener, add:

```typescript
// In the sidecar-stdout listener, after checking pendingRequests:
// If no matching pending request, treat as a notification
if (!pending && response.method) {
  // Emit as a custom event that components can listen to
  window.dispatchEvent(
    new CustomEvent('sidecar-notification', {
      detail: { method: response.method, params: response.params },
    }),
  );
}
```

The full updated `sidecar-stdout` handler becomes:

```typescript
await listen<string>('sidecar-stdout', (event) => {
  try {
    const response = JSON.parse(event.payload);
    const pending = pendingRequests.get(response.id);
    if (pending) {
      pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    } else if (response.method) {
      // Server-pushed notification
      window.dispatchEvent(
        new CustomEvent('sidecar-notification', {
          detail: { method: response.method, params: response.params },
        }),
      );
    }
  } catch {
    console.error('Failed to parse sidecar response:', event.payload);
  }
});
```

- [ ] **Step 7: Run all sidecar tests**

Run: `cd src-sidecar && npx vitest run`
Expected: All tests pass (existing + new handler tests)

- [ ] **Step 8: Commit**

```bash
git add src-sidecar/src/protocol.ts src-sidecar/src/handlers.ts src-sidecar/src/index.ts src-sidecar/tests/handlers.test.ts src/lib/ipc.ts
git commit -m "feat: wire orchestrator into sidecar IPC with notification support"
```

---

### Task 12: E2E Integration Test

**Files:**
- Create: `tests/e2e/orchestrator.test.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/orchestrator.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = join(__dirname, '..', '..', 'src-sidecar');

let child: ChildProcess;
let rl: ReturnType<typeof createInterface>;

function sendRequest(
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = String(Date.now() + Math.random());
    const msg = JSON.stringify({ id, method, params }) + '\n';

    const handler = (line: string) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === id) {
          rl.off('line', handler);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.result);
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    };

    rl.on('line', handler);
    child.stdin!.write(msg);
  });
}

describe('Orchestrator E2E', () => {
  beforeAll(async () => {
    child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
      cwd: sidecarDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    rl = createInterface({ input: child.stdout! });

    // Wait for sidecar to start
    await new Promise<void>((resolve) => {
      child.stderr!.on('data', (data) => {
        if (data.toString().includes('started')) resolve();
      });
    });
  });

  afterAll(() => {
    child.kill();
  });

  it('sidecar responds to ping after orchestrator init', async () => {
    const result = await sendRequest('ping');
    expect(result).toEqual({ status: 'pong' });
  });

  it('creates and lists tasks via IPC', async () => {
    const task = await sendRequest('create_task', {
      title: 'E2E Test Task',
      description: 'Created from E2E test',
    });

    expect(task.title).toBe('E2E Test Task');
    expect(task.status).toBe('pending');

    const tasks = await sendRequest('list_tasks');
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t: any) => t.title === 'E2E Test Task')).toBe(true);
  });

  it('returns empty agent list initially', async () => {
    const agents = await sendRequest('get_agents');
    expect(agents).toEqual([]);
  });

  it('returns error for unknown method', async () => {
    await expect(sendRequest('nonexistent')).rejects.toThrow('Unknown method');
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `npx vitest run --config vitest.e2e.config.ts tests/e2e/orchestrator.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 3: Run ALL tests (unit + E2E) to verify nothing is broken**

Run: `cd src-sidecar && npx vitest run && cd .. && npx vitest run --config vitest.e2e.config.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/orchestrator.test.ts
git commit -m "test: add E2E integration tests for orchestrator IPC"
```
