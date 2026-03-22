import type { CredentialSummaryRow } from './CredentialsSummaryPanel';

interface RuntimeStat {
  label: string;
  value: string;
}

interface CredentialsSurfaceProps {
  title: string;
  description: string;
  statusLabel: string;
  credentialRows: CredentialSummaryRow[];
  loading: boolean;
  error: string | null;
  runtimeStats: RuntimeStat[];
  runtimeActionLabel?: string;
  runtimeActionDisabled?: boolean;
  onRuntimeAction?: () => void;
  onClose?: () => void;
}

export function CredentialsSurface({
  title,
  description,
  statusLabel,
  credentialRows,
  loading,
  error,
  runtimeStats,
  runtimeActionLabel,
  runtimeActionDisabled,
  onRuntimeAction,
  onClose,
}: CredentialsSurfaceProps) {
  return (
    <div className="settings-shell settings-window" data-testid="settings-window">
      <div className="settings-topbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>{title}</h2>
          <p className="settings-copy">{description}</p>
        </div>
        <div className="settings-topbar-actions">
          <span className="settings-chip">{statusLabel}</span>
          {onRuntimeAction && runtimeActionLabel && (
            <button
              className="secondary-button"
              type="button"
              data-testid="settings-runtime-action"
              onClick={onRuntimeAction}
              disabled={runtimeActionDisabled}
            >
              {runtimeActionLabel}
            </button>
          )}
          {onClose && (
            <button
              className="secondary-button"
              type="button"
              data-testid="settings-close"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>

      <div className="settings-grid settings-grid-tight">
        <div className="settings-card">
          <div className="panel-header">
            <h3>Managed Runtime</h3>
            <span>{loading ? 'Refreshing' : 'Secure profile routing'}</span>
          </div>
          <p className="settings-copy compact">
            Nemoclaw manages provider secrets, hosted-model credentials, and local model access.
            LocalTeam stores only team definitions and non-secret runtime profile refs.
          </p>
          <div className="credential-status-list settings-status-list">
            {runtimeStats.map((stat) => (
              <div key={stat.label} className="credential-summary-row ready">
                <div className="credential-summary-copy">
                  <span>{stat.label}</span>
                </div>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-card">
          <div className="panel-header">
            <h3>Runtime Profile Bindings</h3>
            <span>{credentialRows.length} refs</span>
          </div>
          <p className="settings-copy compact">
            Teams can mix hosted and local models by assigning each member a Nemoclaw runtime
            profile ref. Unbound members remain visible here until the binding is added.
          </p>
          <div className="credential-status-list settings-status-list">
            {credentialRows.length === 0 ? (
              <div className="credential-summary-row inactive">
                <div className="credential-summary-copy">
                  <span>No bindings configured</span>
                  <small>Add a team member runtime profile ref in the project config.</small>
                </div>
                <strong>Empty</strong>
              </div>
            ) : (
              credentialRows.map((credential) => (
                <div
                  key={credential.id}
                  className={`credential-summary-row ${
                    credential.state === 'connected'
                      ? 'ready'
                      : credential.state === 'configured'
                        ? 'saved-only'
                        : 'inactive'
                  }`}
                >
                  <div className="credential-summary-copy">
                    <span>{credential.label}</span>
                    <small>{credential.detail}</small>
                  </div>
                  <strong>{formatCredentialStateLabel(credential.state)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {error && <p className="recovery-copy settings-error">{error}</p>}
    </div>
  );
}

function formatCredentialStateLabel(state: CredentialSummaryRow['state']): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'configured':
      return 'Configured';
    case 'unbound':
      return 'Needs binding';
  }
}
