import { useEffect, useState, type FormEvent } from 'react';
import './App.css';
import { StatusIndicator } from './components/StatusIndicator';
import { lockVault, readProviderKeys, saveProviderKeys, unlockVault } from './lib/credentials';
import {
  callSidecar,
  initIpc,
  loadProjectSnapshot,
  restartSidecar,
  subscribeToNotifications,
} from './lib/ipc';
import type {
  AgentMessage,
  AgentStatus,
  ConsensusState,
  ProjectConfig,
  ProjectSnapshot,
  SidecarNotification,
  Task,
} from './lib/contracts';

function App() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activityNote, setActivityNote] = useState<string | null>(null);
  const [overrideText, setOverrideText] = useState('');

  useEffect(() => {
    let unsubscribe = () => {};

    void (async () => {
      try {
        await initIpc();
        unsubscribe = subscribeToNotifications(handleNotification);
        const initial = await loadProjectSnapshot();
        setSnapshot(initial);
        setSelectedTemplateId(initial.templates[0]?.id ?? '');
        if (!initial.session) {
          const started = await callSidecar<ProjectSnapshot>('v1.session.start');
          setSnapshot(started);
        }
        setLoading(false);
      } catch (error) {
        setConnectionError(
          error instanceof Error ? error.message : 'Failed to initialize LocalTeam',
        );
        setLoading(false);
      }
    })();

    return () => {
      unsubscribe();
      void lockVault();
    };
  }, []);

  function handleNotification(notification: SidecarNotification): void {
    if (notification.method === 'v1.sidecar.terminated') {
      setConnectionError('Sidecar terminated');
      return;
    }

    if (notification.method === 'v1.sidecar.started') {
      setConnectionError(null);
      return;
    }

    if (notification.method === 'v1.task.updated') {
      const task = notification.params.task as Task;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              tasks: upsertById(current.tasks, task),
            }
          : current,
      );
      if (!selectedTaskId) {
        setSelectedTaskId(task.id);
      }
      return;
    }

    if (notification.method === 'v1.session.message') {
      const message = notification.params.message as AgentMessage;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: [...current.messages.filter((item) => item.id !== message.id), message],
            }
          : current,
      );
      if (message.taskId) {
        setSelectedTaskId(message.taskId);
      }
      return;
    }

    if (notification.method === 'v1.consensus.updated') {
      const consensus = notification.params.consensus as ConsensusState;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              consensus: upsertByTaskId(current.consensus, consensus),
            }
          : current,
      );
      return;
    }

    if (notification.method === 'v1.agent.updated') {
      const agent = notification.params.agent as AgentStatus;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              agentStatuses: upsertByAgentId(current.agentStatuses, agent),
            }
          : current,
      );
      return;
    }

    if (notification.method === 'v1.credentials.updated') {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              credentials: notification.params.credentials as ProjectSnapshot['credentials'],
            }
          : current,
      );
      return;
    }

    if (notification.method === 'v1.session.updated') {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              session: notification.params.session as ProjectSnapshot['session'],
            }
          : current,
      );
      return;
    }

    if (notification.method === 'v1.project.external_change') {
      const relativePath = String(notification.params.relativePath ?? 'unknown');
      setActivityNote(`External file change detected: ${relativePath}`);
      return;
    }

    if (notification.method === 'v1.shell.notification') {
      const title = String(notification.params.title ?? 'LocalTeam');
      const body = String(notification.params.body ?? '');
      setActivityNote(`${title}: ${body}`);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }

  async function handleUnlockVault(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await unlockVault(vaultPassword);
      const values = await readProviderKeys(vaultPassword);
      setOpenaiKey(values.openai ?? '');
      setAnthropicKey(values.anthropic ?? '');
      await callSidecar('v1.credentials.sync', { values });
      setVaultUnlocked(true);
      setConnectionError(null);
      const latest = await callSidecar<ProjectSnapshot>('v1.status');
      setSnapshot(latest);
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to unlock credential vault',
      );
    }
  }

  async function handleSaveCredentials(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await saveProviderKeys(vaultPassword, {
        openai: openaiKey,
        anthropic: anthropicKey,
      });
      const values = await readProviderKeys(vaultPassword);
      await callSidecar('v1.credentials.sync', { values });
      const latest = await callSidecar<ProjectSnapshot>('v1.status');
      setSnapshot(latest);
      setActivityNote('Provider credentials synced to the sidecar.');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to save provider credentials',
      );
    }
  }

  async function handleApplyTemplate(): Promise<void> {
    if (!selectedTemplateId) {
      return;
    }

    try {
      const config = await callSidecar<ProjectConfig>('v1.templates.get', {
        id: selectedTemplateId,
      });
      const latest = await callSidecar<ProjectSnapshot>('v1.project.save', { config });
      setSnapshot(latest);
      setActivityNote(`Applied template: ${latest.config?.team.name ?? selectedTemplateId}`);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to apply team template',
      );
    }
  }

  async function handleCreateTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!taskTitle.trim() || !taskDescription.trim()) {
      return;
    }

    try {
      const latest = await callSidecar<ProjectSnapshot>('v1.task.create', {
        title: taskTitle.trim(),
        description: taskDescription.trim(),
      });
      setSnapshot(latest);
      setTaskTitle('');
      setTaskDescription('');
      setOverrideText('');
      const newestTask = latest.tasks[latest.tasks.length - 1];
      if (newestTask) {
        setSelectedTaskId(newestTask.id);
      }
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to create task',
      );
    }
  }

  async function handleConsensusAction(
    taskId: string,
    action: 'continue' | 'override' | 'approve_majority',
  ): Promise<void> {
    try {
      const latest = await callSidecar<ProjectSnapshot>('v1.consensus.resolve', {
        taskId,
        action,
        overrideMessage: overrideText.trim() || undefined,
      });
      setSnapshot(latest);
      setOverrideText('');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to resolve consensus',
      );
    }
  }

  async function handleRestartSidecar(): Promise<void> {
    try {
      await restartSidecar();
      const latest = await loadProjectSnapshot();
      setSnapshot(latest);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to restart sidecar',
      );
    }
  }

  const tasks = snapshot?.tasks ?? [];
  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ??
    tasks[tasks.length - 1] ??
    null;
  const selectedMessages = snapshot?.messages.filter((message) =>
    selectedTask ? message.taskId === selectedTask.id : true,
  ) ?? [];
  const selectedConsensus = snapshot?.consensus.find(
    (entry) => entry.taskId === selectedTask?.id,
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Windows-first agent workstation</p>
          <h1>LocalTeam</h1>
          <p className="hero-copy">
            Load the project, unlock the vault, and watch the panel debate tasks in
            real time.
          </p>
        </div>
        <div className="hero-actions">
          <StatusIndicator snapshot={snapshot} connectionError={connectionError} />
          <button className="secondary-button" onClick={handleRestartSidecar}>
            Restart Sidecar
          </button>
        </div>
      </header>

      {activityNote && <div className="activity-banner">{activityNote}</div>}

      <main className="workspace">
        <section className="left-column">
          <div className="panel composer-panel">
            <div className="panel-header">
              <h2>Task Composer</h2>
              <span>
                {snapshot?.config?.team.name ?? 'Loading team'}
              </span>
            </div>
            <form className="task-form" onSubmit={handleCreateTask}>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Task title"
              />
              <textarea
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                placeholder="Describe the work and decision pressure."
                rows={4}
              />
              <button className="primary-button" type="submit">
                Start Discussion
              </button>
            </form>
          </div>

          <div className="panel conversation-panel">
            <div className="panel-header">
              <h2>Conversation Stream</h2>
              <span>{selectedTask?.title ?? 'All activity'}</span>
            </div>
            <div className="message-list">
              {loading && <div className="empty-state">Loading project state…</div>}
              {!loading && selectedMessages.length === 0 && (
                <div className="empty-state">No messages yet. Start a task to begin.</div>
              )}
              {selectedMessages.map((message) => (
                <article key={message.id} className={`message-card type-${message.type}`}>
                  <header>
                    <strong>{message.agentRole}</strong>
                    <span>{formatTimestamp(message.timestamp)}</span>
                  </header>
                  <p>{message.content}</p>
                  <footer>
                    <span>{message.type}</span>
                    <span>{message.tokenEstimate ?? 0} tok est.</span>
                    <span>Round {message.round ?? 1}</span>
                  </footer>
                </article>
              ))}
            </div>

            {selectedConsensus?.status === 'escalated' && selectedTask && (
              <div className="consensus-panel">
                <div className="panel-header">
                  <h3>Consensus Escalation</h3>
                  <span>Round {selectedConsensus.round}</span>
                </div>
                <div className="consensus-summary">
                  {selectedConsensus.summary.map((position) => (
                    <div key={position.agentId} className="consensus-item">
                      <strong>{position.agentId}</strong>
                      <p>{position.position}</p>
                    </div>
                  ))}
                </div>
                <textarea
                  value={overrideText}
                  onChange={(event) => setOverrideText(event.target.value)}
                  placeholder="Optional user guidance or override note"
                  rows={3}
                />
                <div className="consensus-actions">
                  <button
                    className="secondary-button"
                    onClick={() => handleConsensusAction(selectedTask.id, 'continue')}
                  >
                    Run Another Round
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => handleConsensusAction(selectedTask.id, 'override')}
                  >
                    Approve Override
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="right-column">
          <div className="panel">
            <div className="panel-header">
              <h2>Vault & Providers</h2>
              <span>{vaultUnlocked ? 'Unlocked' : 'Locked'}</span>
            </div>
            <form className="vault-form" onSubmit={handleUnlockVault}>
              <input
                type="password"
                value={vaultPassword}
                onChange={(event) => setVaultPassword(event.target.value)}
                placeholder="Vault password"
              />
              <button className="secondary-button" type="submit">
                Unlock Vault
              </button>
            </form>

            <form className="credential-form" onSubmit={handleSaveCredentials}>
              <input
                value={openaiKey}
                onChange={(event) => setOpenaiKey(event.target.value)}
                placeholder="OpenAI API key"
                disabled={!vaultUnlocked}
              />
              <input
                value={anthropicKey}
                onChange={(event) => setAnthropicKey(event.target.value)}
                placeholder="Anthropic API key"
                disabled={!vaultUnlocked}
              />
              <button className="primary-button" type="submit" disabled={!vaultUnlocked}>
                Save & Sync Keys
              </button>
            </form>

            <div className="credential-status-list">
              {(snapshot?.credentials ?? []).map((credential) => (
                <div key={credential.provider} className="credential-status">
                  <span>{credential.provider}</span>
                  <strong>{credential.hasKey ? 'Ready' : 'Missing'}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Team Template</h2>
              <span>{snapshot?.templates.length ?? 0} available</span>
            </div>
            <select
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              {(snapshot?.templates ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button className="secondary-button" onClick={handleApplyTemplate}>
              Apply Template
            </button>
            <div className="template-meta">
              <p>
                {snapshot?.templates.find((template) => template.id === selectedTemplateId)
                  ?.description ?? 'Select a template to update localteam.json.'}
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Agent Panel</h2>
              <span>{snapshot?.agentStatuses.length ?? 0} agents</span>
            </div>
            <div className="agent-list">
              {(snapshot?.agentStatuses ?? []).map((agent) => (
                <button
                  key={agent.agentId}
                  className={`agent-card status-${agent.status}`}
                  onClick={() => {
                    const matchingTask = tasks.find((task) =>
                      task.assignedAgents.includes(agent.agentId),
                    );
                    if (matchingTask) {
                      setSelectedTaskId(matchingTask.id);
                    }
                  }}
                >
                  <strong>{agent.role}</strong>
                  <span>{agent.model}</span>
                  <span>{agent.provider}</span>
                  <span>{agent.status.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <section className="board-shell">
        <div className="board-header">
          <h2>Task Board</h2>
          <span>
            {snapshot?.projectRoot ?? 'No project root'}
          </span>
        </div>
        <div className="board-grid">
          {(['pending', 'in_progress', 'review', 'completed'] as const).map((status) => (
            <div key={status} className="board-column">
              <header>{formatStatusLabel(status)}</header>
              <div className="board-cards">
                {tasks
                  .filter((task) => task.status === status)
                  .map((task) => (
                    <button
                      key={task.id}
                      className={`task-card ${task.id === selectedTask?.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <strong>{task.title}</strong>
                      <p>{task.description}</p>
                      <footer>
                        <span>{task.assignedAgents.length} agents</span>
                        <span>{task.tokenEstimate} tok est.</span>
                      </footer>
                    </button>
                  ))}
                {tasks.filter((task) => task.status === status).length === 0 && (
                  <div className="empty-column">No tasks</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  return [...items.filter((item) => item.id !== next.id), next].sort(
    (left, right) => {
      const leftUpdated = 'updatedAt' in left ? Number(left.updatedAt) : 0;
      const rightUpdated = 'updatedAt' in right ? Number(right.updatedAt) : 0;
      return leftUpdated - rightUpdated;
    },
  );
}

function upsertByTaskId(items: ConsensusState[], next: ConsensusState): ConsensusState[] {
  return [...items.filter((item) => item.taskId !== next.taskId), next].sort(
    (left, right) => left.updatedAt - right.updatedAt,
  );
}

function upsertByAgentId(items: AgentStatus[], next: AgentStatus): AgentStatus[] {
  return [...items.filter((item) => item.agentId !== next.agentId), next].sort(
    (left, right) => left.role.localeCompare(right.role),
  );
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStatusLabel(status: Task['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'in_progress':
      return 'In Progress';
    case 'review':
      return 'Review';
    case 'completed':
      return 'Completed';
  }
}

export default App;
