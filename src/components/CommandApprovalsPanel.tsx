import type { CommandApproval, Task } from '../lib/contracts';

interface CommandApprovalsPanelProps {
  approvals: CommandApproval[];
  tasks: Task[];
  selectedTaskId: string | null;
  busyApprovalId: string | null;
  error: string | null;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}

export function CommandApprovalsPanel({
  approvals,
  tasks,
  selectedTaskId,
  busyApprovalId,
  error,
  onApprove,
  onDeny,
}: CommandApprovalsPanelProps) {
  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null;
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const settledApprovals = approvals.filter((approval) => approval.status !== 'pending');

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Command Approvals</h2>
        <span>
          {pendingApprovals.length} pending • {settledApprovals.length} settled
        </span>
      </div>
      <div className="command-approval-copy">
        <p>
          Pending approvals require a human decision before the sidecar runs shell
          commands. Completed items stay visible for audit.
        </p>
        <span>{selectedTask ? `Selected task: ${selectedTask.title}` : 'All tasks'}</span>
      </div>
      {error && <p className="recovery-copy settings-error">{error}</p>}
      <div className="approval-list">
        {pendingApprovals.length === 0 && (
          <div className="empty-state">No pending command approvals.</div>
        )}
        {pendingApprovals.map((approval) => (
          <article key={approval.id} className="approval-card approval-pending">
            <header>
              <div>
                <strong>{approval.agentRole}</strong>
                <p>{approval.command}</p>
              </div>
              <span>{approval.status}</span>
            </header>
            <div className="approval-meta">
              <span>Task {shortId(approval.taskId)}</span>
              <span>{approval.policy.sandboxMode} sandbox</span>
              <span>{approval.requiresApproval ? 'Needs approval' : 'Pre-approved'}</span>
              {approval.reason && <span>{approval.reason}</span>}
            </div>
            <div className="approval-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => onApprove(approval.id)}
                disabled={busyApprovalId === approval.id}
              >
                Approve
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onDeny(approval.id)}
                disabled={busyApprovalId === approval.id}
              >
                Deny
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="approval-history">
        <h3>Resolved</h3>
        <div className="approval-list settled">
          {settledApprovals.length === 0 && (
            <div className="empty-state">No completed command approvals yet.</div>
          )}
          {settledApprovals.map((approval) => (
            <article key={approval.id} className={`approval-card approval-${approval.status}`}>
              <header>
                <div>
                  <strong>{approval.agentRole}</strong>
                  <p>{approval.command}</p>
                </div>
                <span>{approval.status}</span>
              </header>
              <div className="approval-meta">
                <span>Task {shortId(approval.taskId)}</span>
                <span>{approval.policy.sandboxMode} sandbox</span>
                {approval.exitCode !== undefined && <span>Exit {approval.exitCode}</span>}
              </div>
              {approval.stdout && <pre className="approval-output">{approval.stdout}</pre>}
              {approval.stderr && <pre className="approval-output error">{approval.stderr}</pre>}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}
