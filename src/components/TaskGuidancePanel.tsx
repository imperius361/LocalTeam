import type { Task } from '../lib/contracts';

interface TaskGuidancePanelProps {
  selectedTask: Task | null;
  guidance: string;
  onGuidanceChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  onSendGuidance: () => void;
}

export function TaskGuidancePanel({
  selectedTask,
  guidance,
  onGuidanceChange,
  busy,
  error,
  onSendGuidance,
}: TaskGuidancePanelProps) {
  return (
    <div className="panel guidance-panel">
      <div className="panel-header">
        <h2>Task Guidance</h2>
        <span>{selectedTask?.title ?? 'Select a task'}</span>
      </div>
      <p className="recovery-copy">
        Send guidance to the selected task without creating a new branch of work.
      </p>
      <textarea
        value={guidance}
        onChange={(event) => onGuidanceChange(event.target.value)}
        placeholder="Add a short correction, constraint, or direction for the active discussion."
        rows={4}
        disabled={!selectedTask || busy}
      />
      <div className="guidance-actions">
        <button
          className="primary-button"
          type="button"
          onClick={onSendGuidance}
          disabled={!selectedTask || busy || !guidance.trim()}
        >
          {busy ? 'Sending...' : 'Send Guidance'}
        </button>
      </div>
      {error && <p className="recovery-copy settings-error">{error}</p>}
    </div>
  );
}
