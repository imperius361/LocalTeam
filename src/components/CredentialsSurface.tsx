import type { FormEvent } from 'react';
import type { CredentialSummaryRow } from './CredentialsSummaryPanel';

interface CredentialsSurfaceProps {
  title: string;
  description: string;
  statusLabel: string;
  credentialRows: CredentialSummaryRow[];
  vaultUnlocked: boolean;
  vaultExists: boolean;
  loading: boolean;
  error: string | null;
  vaultPassword: string;
  openaiKey: string;
  anthropicKey: string;
  canSave: boolean;
  onVaultPasswordChange: (value: string) => void;
  onOpenaiKeyChange: (value: string) => void;
  onAnthropicKeyChange: (value: string) => void;
  onUnlockVault: (event: FormEvent<HTMLFormElement>) => void;
  onSaveCredentials: (event: FormEvent<HTMLFormElement>) => void;
  onClearProvider: (provider: CredentialSummaryRow['provider']) => void;
  onLockVault: () => void;
  onClose?: () => void;
  unlockButtonLabel: string;
  saveButtonLabel: string;
}

export function CredentialsSurface({
  title,
  description,
  statusLabel,
  credentialRows,
  vaultUnlocked,
  vaultExists,
  loading,
  error,
  vaultPassword,
  openaiKey,
  anthropicKey,
  canSave,
  onVaultPasswordChange,
  onOpenaiKeyChange,
  onAnthropicKeyChange,
  onUnlockVault,
  onSaveCredentials,
  onClearProvider,
  onLockVault,
  onClose,
  unlockButtonLabel,
  saveButtonLabel,
}: CredentialsSurfaceProps) {
  return (
    <div className="settings-shell settings-window">
      <div className="settings-topbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>{title}</h2>
          <p className="settings-copy">{description}</p>
        </div>
        <div className="settings-topbar-actions">
          <span className="settings-chip">{statusLabel}</span>
          {onClose && (
            <button className="secondary-button" type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      <div className="settings-grid settings-grid-tight">
        <div className="settings-card">
          <div className="panel-header">
            <h3>{vaultUnlocked ? 'Vault session' : vaultExists ? 'Unlock vault' : 'Create vault'}</h3>
            <span>{vaultUnlocked ? 'Unlocked' : vaultExists ? 'Locked' : 'Not set up'}</span>
          </div>
          {vaultUnlocked ? (
            <>
              <p className="settings-copy compact">
                This app session can update stored keys and sync them into the sidecar runtime.
              </p>
              <div className="settings-actions row-end">
                <button className="secondary-button" type="button" onClick={onLockVault}>
                  Lock Vault
                </button>
              </div>
            </>
          ) : (
            <form className="vault-form" onSubmit={onUnlockVault}>
              <input
                type="password"
                value={vaultPassword}
                onChange={(event) => onVaultPasswordChange(event.target.value)}
                placeholder={vaultExists ? 'Enter vault password' : 'Create a vault password'}
              />
              <button className="secondary-button" type="submit" disabled={loading}>
                {unlockButtonLabel}
              </button>
            </form>
          )}
        </div>

        <div className="settings-card">
          <div className="panel-header">
            <h3>Provider keys</h3>
            <span>{credentialRows.length} providers</span>
          </div>
          <p className="settings-copy compact">
            Add the provider keys you want LocalTeam to save on this device. Unused providers can
            stay blank.
          </p>
          <form className="credential-form" onSubmit={onSaveCredentials}>
            <div className="credential-input-row">
              <input
                type="password"
                value={openaiKey}
                onChange={(event) => onOpenaiKeyChange(event.target.value)}
                placeholder="OpenAI API key"
                disabled={!vaultUnlocked}
              />
              <button
                className="secondary-button inline-utility-button"
                type="button"
                disabled={!vaultUnlocked || !credentialRows.find((row) => row.provider === 'openai')?.hasStoredKey}
                onClick={() => onClearProvider('openai')}
              >
                Clear
              </button>
            </div>
            <div className="credential-input-row">
              <input
                type="password"
                value={anthropicKey}
                onChange={(event) => onAnthropicKeyChange(event.target.value)}
                placeholder="Anthropic API key"
                disabled={!vaultUnlocked}
              />
              <button
                className="secondary-button inline-utility-button"
                type="button"
                disabled={
                  !vaultUnlocked || !credentialRows.find((row) => row.provider === 'anthropic')?.hasStoredKey
                }
                onClick={() => onClearProvider('anthropic')}
              >
                Clear
              </button>
            </div>
            <div className="settings-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={!vaultUnlocked || !canSave}
              >
                {saveButtonLabel}
              </button>
            </div>
          </form>
          {error && <p className="recovery-copy settings-error">{error}</p>}
        </div>
      </div>

      <div className="credential-status-list settings-status-list">
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
                    ? 'Stored in the vault'
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
