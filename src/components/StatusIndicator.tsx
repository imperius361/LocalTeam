import { useState, useEffect } from 'react';
import { callSidecar } from '../lib/ipc';

interface SidecarStatus {
  uptime: number;
  version: string;
}

export function StatusIndicator() {
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const result = await callSidecar<SidecarStatus>('status');
        setStatus(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setStatus(null);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="status-indicator">
      <div className={`status-dot ${status ? 'connected' : 'disconnected'}`} />
      <span className="status-text">
        {status
          ? `Sidecar v${status.version} — up ${Math.round(status.uptime / 1000)}s`
          : error ?? 'Connecting...'}
      </span>
    </div>
  );
}
