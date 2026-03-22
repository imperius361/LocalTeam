export type CredentialSummaryRow = {
  id: string;
  label: string;
  assignedMembers: number;
  state: 'connected' | 'configured' | 'unbound';
  detail: string;
};

interface CredentialsSummaryPanelProps {
  credentialRows: CredentialSummaryRow[];
  statusLabel: string;
  onOpenSettings: () => void;
}

export function CredentialsSummaryPanel({
  credentialRows,
  statusLabel,
  onOpenSettings,
}: CredentialsSummaryPanelProps) {
  const connectedCount = credentialRows.filter((row) => row.state === 'connected').length;
  const configuredCount = credentialRows.filter((row) => row.state === 'configured').length;
  const unboundCount = credentialRows.filter((row) => row.state === 'unbound').length;

  return (
    <div className="panel credential-summary-panel">
      <div className="panel-header">
        <h2>Model Access</h2>
        <span>{statusLabel}</span>
      </div>
      <p className="recovery-copy">
        Nemoclaw manages provider secrets and hosted-model access. LocalTeam only tracks which
        runtime profile refs each team member expects to use.
      </p>
      <div className="credential-summary-list">
        {credentialRows.map((credential) => (
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
        ))}
      </div>
      <div className="credential-summary-actions">
        <button className="secondary-button" type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
      {unboundCount > 0 && (
        <p className="recovery-copy">
          {unboundCount} binding{unboundCount === 1 ? '' : 's'} still need a Nemoclaw runtime
          profile ref before that member can use a hosted or local model.
        </p>
      )}
      {unboundCount === 0 && configuredCount > 0 && (
        <p className="recovery-copy">
          {configuredCount} profile ref{configuredCount === 1 ? '' : 's'} are configured in the
          project but not yet reflected in the live runtime bridge.
        </p>
      )}
      {connectedCount > 0 && (
        <p className="recovery-copy">
          {connectedCount} binding{connectedCount === 1 ? '' : 's'} are visible in the active
          runtime session.
        </p>
      )}
      {credentialRows.length === 0 && (
        <p className="recovery-copy">
          No runtime profile refs are configured yet. Add members to a team and bind them to
          Nemoclaw profiles in project settings.
        </p>
      )}
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
