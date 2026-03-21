export type CredentialSummaryRow = {
  provider: 'openai' | 'anthropic';
  hasStoredKey: boolean;
  hasRuntimeKey: boolean;
  required: boolean;
};

interface CredentialsSummaryPanelProps {
  credentialRows: CredentialSummaryRow[];
  statusLabel: string;
  vaultUnlocked: boolean;
  onOpenSettings: () => void;
  onLockVault: () => void;
}

export function CredentialsSummaryPanel({
  credentialRows,
  statusLabel,
  vaultUnlocked,
  onOpenSettings,
  onLockVault,
}: CredentialsSummaryPanelProps) {
  const hasStoredKeys = credentialRows.some((credential) => credential.hasStoredKey);
  const hasRequiredMissing = credentialRows.some(
    (credential) => credential.required && !credential.hasStoredKey,
  );
  const hasRequiredUnsynced = credentialRows.some(
    (credential) => credential.required && credential.hasStoredKey && !credential.hasRuntimeKey,
  );

  return (
    <div className="panel credential-summary-panel">
      <div className="panel-header">
        <h2>Agent API Keys</h2>
        <span>{statusLabel}</span>
      </div>
      <p className="recovery-copy">
        Manage provider keys in Settings. The dashboard only shows live readiness and vault state.
      </p>
      <div className="credential-summary-list">
        {credentialRows.map((credential) => (
          <div
            key={credential.provider}
            className={`credential-summary-row ${credential.required ? 'required' : 'optional'} ${
              credential.hasRuntimeKey
                ? 'ready'
                : credential.hasStoredKey
                  ? 'saved-only'
                  : 'inactive'
            }`}
          >
            <div className="credential-summary-copy">
              <span>{formatProviderLabel(credential.provider)}</span>
              <small>
                {credential.hasRuntimeKey
                  ? credential.required
                    ? 'Ready in the live runtime'
                    : 'Available in the live runtime'
                  : credential.hasStoredKey
                    ? 'Stored in the vault. Open Settings to sync it.'
                    : credential.required
                      ? 'Required by the active team'
                      : 'Optional for the active team'}
              </small>
            </div>
            <strong>
              {formatCredentialStateLabel(
                credential.hasRuntimeKey,
                credential.required,
                credential.hasStoredKey,
              )}
            </strong>
          </div>
        ))}
      </div>
      <div className="credential-summary-actions">
        <button className="secondary-button" type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
        {vaultUnlocked && (
          <button className="secondary-button" type="button" onClick={onLockVault}>
            Lock Vault
          </button>
        )}
      </div>
      {hasRequiredUnsynced && (
        <p className="recovery-copy">
          Some required keys are saved but not synced to the live runtime. Open Settings and unlock
          the vault to load them.
        </p>
      )}
      {hasRequiredMissing && !hasRequiredUnsynced && (
        <p className="recovery-copy">
          Some required provider keys are still missing. Open Settings to add them before starting
          a live discussion.
        </p>
      )}
      {!hasStoredKeys && (
        <p className="recovery-copy">
          No API keys are stored yet. Open Settings to create the vault and save provider keys on
          this device.
        </p>
      )}
    </div>
  );
}

function formatProviderLabel(provider: CredentialSummaryRow['provider']): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
  }
}

function formatCredentialStateLabel(
  hasRuntimeKey: boolean,
  required: boolean,
  hasStoredKey = false,
): string {
  if (hasRuntimeKey) {
    return required ? 'Ready' : 'Saved';
  }
  if (hasStoredKey) {
    return 'Stored';
  }
  return required ? 'Missing' : 'Optional';
}
