import type { ProjectSnapshot } from '../lib/contracts';
import { countActiveRequestTasks } from '../lib/taskSelectors';

interface StatusIndicatorProps {
  snapshot: ProjectSnapshot | null;
  connectionError: string | null;
}

export function StatusIndicator({
  snapshot,
  connectionError,
}: StatusIndicatorProps) {
  const ready = snapshot?.sidecar.ready && !connectionError;
  const uptime = snapshot ? Math.round(snapshot.sidecar.uptime / 1000) : 0;
  const activeAgents =
    snapshot?.agentStatuses.filter((agent) =>
      ['thinking', 'writing', 'waiting_for_consensus'].includes(agent.status),
    ).length ?? 0;
  const activeTasks =
    snapshot ? countActiveRequestTasks(snapshot.tasks) : 0;
  const sandboxMode = snapshot?.config?.sandbox.defaultMode ?? 'direct';

  return (
    <div className="status-indicator">
      <div className={`status-dot ${ready ? 'connected' : 'disconnected'}`} />
      <div className="status-content">
        <span className="status-text">
          {ready
            ? `Sidecar v${snapshot?.sidecar.version} online`
            : connectionError ?? 'Waiting for sidecar'}
        </span>
        <span className="status-subtext">
          {snapshot?.session
            ? `Session ${snapshot.session.status} • up ${uptime}s`
            : `No active session • up ${uptime}s`}
        </span>
        <span className="status-subtext">
          {activeTasks} active task{activeTasks === 1 ? '' : 's'} • {activeAgents} active
          agent{activeAgents === 1 ? '' : 's'} • {sandboxMode} sandbox
        </span>
      </div>
    </div>
  );
}
