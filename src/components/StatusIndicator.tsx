import type { ProjectSnapshot } from '../lib/contracts';

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
      </div>
    </div>
  );
}
