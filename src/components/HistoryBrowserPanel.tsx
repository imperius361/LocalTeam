import { useMemo, useState } from 'react';
import type { AgentMessage, Task } from '../lib/contracts';

interface HistoryBrowserPanelProps {
  tasks: Task[];
  messages: AgentMessage[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

type HistoryScope = 'all' | 'tasks' | 'messages';

export function HistoryBrowserPanel({
  tasks,
  messages,
  selectedTaskId,
  onSelectTask,
}: HistoryBrowserPanelProps) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<HistoryScope>('all');

  const normalized = search.trim().toLowerCase();
  const taskMatches = useMemo(() => {
    if (!normalized && scope === 'messages') {
      return [];
    }
    return tasks.filter((task) => {
      if (scope === 'messages') {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return [task.title, task.description, task.status, task.consensusState ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [normalized, scope, tasks]);

  const messageMatches = useMemo(() => {
    if (!normalized && scope === 'tasks') {
      return [];
    }
    return messages.filter((message) => {
      if (scope === 'tasks') {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return [message.agentRole, message.content, message.type, message.taskId ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [messages, normalized, scope]);

  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null;

  return (
    <div className="panel history-panel">
      <div className="panel-header">
        <h2>History Browser</h2>
        <span>
          {taskMatches.length} tasks • {messageMatches.length} messages
        </span>
      </div>
      <div className="history-controls">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tasks, messages, roles, and content"
        />
        <div className="scope-toggle history-scope-toggle" role="group" aria-label="History scope">
          {(['all', 'tasks', 'messages'] as const).map((option) => (
            <button
              key={option}
              className={`secondary-button ${scope === option ? 'active' : ''}`}
              type="button"
              onClick={() => setScope(option)}
            >
              {option === 'all' ? 'All' : option === 'tasks' ? 'Tasks' : 'Messages'}
            </button>
          ))}
        </div>
      </div>
      <div className="history-summary">
        <span>{selectedTask ? `Selected: ${selectedTask.title}` : 'No task selected'}</span>
        <span>{search.trim() ? `Filtering for “${search.trim()}”` : 'Showing recent history'}</span>
      </div>
      <div className="history-results">
        {taskMatches.map((task) => (
          <button
            key={task.id}
            className={`history-result task-result ${task.id === selectedTaskId ? 'selected' : ''}`}
            type="button"
            onClick={() => onSelectTask(task.id)}
          >
            <strong>{task.title}</strong>
            <p>{task.description}</p>
            <footer>
              <span>{task.status}</span>
              <span>{task.assignedAgents.length} agents</span>
              <span>{task.consensusState ?? 'pending'}</span>
            </footer>
          </button>
        ))}
        {messageMatches.map((message) => (
          <button
            key={message.id}
            className="history-result message-result"
            type="button"
            onClick={() => message.taskId && onSelectTask(message.taskId)}
          >
            <strong>{message.agentRole}</strong>
            <p>{message.content}</p>
            <footer>
              <span>{message.type}</span>
              <span>{message.taskId ? shortId(message.taskId) : 'No task'}</span>
              <span>Round {message.round ?? 1}</span>
            </footer>
          </button>
        ))}
        {taskMatches.length === 0 && messageMatches.length === 0 && (
          <div className="empty-state">No history matches this search.</div>
        )}
      </div>
    </div>
  );
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}
