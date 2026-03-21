import type { Task } from '../../lib/contracts';
import type { TaskTreeRow } from '../../lib/taskSelectors';

interface TaskHierarchyPanelProps {
  rows: TaskTreeRow[];
  selectedRootTaskId: string | null;
  agentRoleById: Record<string, string>;
  onSelectRootTask: (taskId: string) => void;
}

export function TaskHierarchyPanel({
  rows,
  selectedRootTaskId,
  agentRoleById,
  onSelectRootTask,
}: TaskHierarchyPanelProps) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '2px',
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        Requests
      </div>
      <div
        style={{
          border: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          minHeight: 180,
          overflowY: 'auto',
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            No requests yet.
          </div>
        ) : (
          rows.map((row) => {
            const isSelected =
              (row.parentTask?.id ?? row.task.id) === selectedRootTaskId &&
              row.depth === 0;
            const isSubtask = row.depth > 0;
            return (
              <button
                key={row.task.id}
                type="button"
                onClick={() => onSelectRootTask(row.parentTask?.id ?? row.task.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  background: isSelected && !isSubtask ? 'var(--bg-raised)' : 'transparent',
                  color: 'inherit',
                  padding: `10px 12px 10px ${12 + row.depth * 20}px`,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      color: isSubtask ? 'var(--cyan)' : 'var(--accent)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {isSubtask ? '>' : '#'}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: getTaskStatusColor(row.task.status),
                    }}
                  >
                    {formatTaskStatus(row.task.status)}
                  </span>
                  {isSubtask && (
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                        padding: '1px 6px',
                      }}
                    >
                      Agent Subtask
                    </span>
                  )}
                  {row.task.createdByAgentId && (
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                      }}
                    >
                      by {agentRoleById[row.task.createdByAgentId] ?? row.task.createdByAgentId}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    marginBottom: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {row.task.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {row.task.description}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function formatTaskStatus(status: Task['status']): string {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    case 'review':
      return 'Review';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'pending':
    default:
      return 'Pending';
  }
}

function getTaskStatusColor(status: Task['status']): string {
  switch (status) {
    case 'in_progress':
      return 'var(--yellow)';
    case 'review':
      return 'var(--cyan)';
    case 'completed':
      return 'var(--green)';
    case 'cancelled':
      return 'var(--red)';
    case 'pending':
    default:
      return 'var(--text-muted)';
  }
}
