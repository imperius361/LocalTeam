import type { Task } from '../../lib/contracts';

interface ManagerReviewPanelProps {
  task: Task | null;
  managerRole?: string;
  busyAction: 'approve' | 'modify' | 'reject' | null;
  error: string | null;
  modifyDraft: string;
  onModifyDraftChange: (value: string) => void;
  onApprove: () => void;
  onModify: () => void;
  onReject: () => void;
}

export function ManagerReviewPanel({
  task,
  managerRole,
  busyAction,
  error,
  modifyDraft,
  onModifyDraftChange,
  onApprove,
  onModify,
  onReject,
}: ManagerReviewPanelProps) {
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
        Manager Review
      </div>
      <div
        style={{
          border: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          padding: 12,
          minHeight: 240,
          boxSizing: 'border-box',
        }}
      >
        {!task ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Select a request to review the manager plan.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
              {managerRole ? `${managerRole} summary` : 'Manager summary'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>
              {task.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                marginBottom: 12,
              }}
            >
              {task.reviewSummary?.summaryText ?? task.description}
            </div>
            {task.status === 'review' && (
              <>
                <textarea
                  value={modifyDraft}
                  onChange={(event) => onModifyDraftChange(event.target.value)}
                  placeholder="Add modification guidance for the manager..."
                  style={{
                    width: '100%',
                    minHeight: 88,
                    resize: 'vertical',
                    background: 'var(--bg-base)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    padding: 10,
                    boxSizing: 'border-box',
                    marginBottom: 10,
                  }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={onApprove}
                    disabled={busyAction !== null}
                  >
                    {busyAction === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={onModify}
                    disabled={busyAction !== null || !modifyDraft.trim()}
                  >
                    {busyAction === 'modify' ? 'Sending…' : 'Modify'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={onReject}
                    disabled={busyAction !== null}
                  >
                    {busyAction === 'reject' ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </>
            )}
            {task.status !== 'review' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Current state: {task.status}
              </div>
            )}
            {error && (
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--red)' }}>{error}</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
