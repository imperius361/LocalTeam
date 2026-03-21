import type { FormEvent } from 'react';
import React, { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '../store/appStore';
import { clearProviderKey, createVault, getCredentialStatus, lockVault, saveProviderKeys, subscribeToCredentialEvents, unlockVault, type CredentialStatus } from '../lib/credentials';
import { closeCurrentWindow, loadProjectSnapshot, pickProjectFolder } from '../lib/ipc';
import { formatWorkspaceError, loadAndStoreWorkspace } from '../lib/workspace';

import type { CredentialSummaryRow } from './CredentialsSummaryPanel';
import { CredentialsSurface } from './CredentialsSurface';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';

const DEFAULT_CREDENTIAL_STATUS: CredentialStatus = {
  unlocked: false,
  vaultExists: false,
  providers: [
    { provider: 'openai', hasKey: false },
    { provider: 'anthropic', hasKey: false },
  ],
};
const MANAGED_PROVIDERS: CredentialSummaryRow['provider'][] = ['openai', 'anthropic'];

export function SettingsWindow(): React.ReactElement {
  const snapshot = useAppStore((s) => s.snapshot);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const addRecentProject = useAppStore((s) => s.addRecentProject);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>(DEFAULT_CREDENTIAL_STATUS);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');

  const currentRoot = snapshot?.projectRoot ?? null;
  const config = snapshot?.config ?? null;

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    void (async () => {
      try {
        const status = await getCredentialStatus();
        if (!disposed) {
          setCredentialStatus(status);
          setCredentialsError(null);
        }
      } catch (error) {
        if (!disposed) {
          setCredentialsError(formatWorkspaceError(error, 'Failed to load credential status.'));
        }
      } finally {
        if (!disposed) {
          setCredentialsLoading(false);
        }
      }

      unsubscribe = await subscribeToCredentialEvents((event) => {
        if (event.type === 'status') {
          setCredentialStatus(event.status);
        }
      });
    })();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const credentialRows = useMemo<CredentialSummaryRow[]>(() => {
    const storedByProvider = new Map(
      credentialStatus.providers.map((provider) => [provider.provider, provider.hasKey]),
    );
    const runtimeByProvider = new Map(
      (snapshot?.credentials ?? []).map((provider) => [provider.provider, provider.hasKey]),
    );
    const requiredProviders = new Set(
      snapshot?.config?.team.agents
        .map((agent) => agent.provider)
        .filter((provider) => provider === 'openai' || provider === 'anthropic') ?? [],
    );

    return MANAGED_PROVIDERS.map((provider) => ({
      provider,
      hasStoredKey: storedByProvider.get(provider) ?? false,
      hasRuntimeKey: runtimeByProvider.get(provider) ?? false,
      required: requiredProviders.has(provider),
    }));
  }, [credentialStatus.providers, snapshot?.config?.team.agents, snapshot?.credentials]);

  const statusLabel = credentialStatus.unlocked
    ? 'Vault unlocked'
    : credentialStatus.vaultExists
      ? 'Vault locked'
      : 'Vault not set up';
  const canSave = Boolean(openaiKey.trim() || anthropicKey.trim());

  async function refreshWorkspace(rootPath: string): Promise<void> {
    setWorkspaceBusy(true);
    setWorkspaceError(null);

    try {
      await loadAndStoreWorkspace(rootPath, {
        loadProjectSnapshot,
        setSnapshot,
        addRecentProject,
        setActiveProjectPath,
      });
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error, 'Failed to load workspace.'));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleChooseWorkspace(): Promise<void> {
    try {
      const selected = await pickProjectFolder(currentRoot ?? undefined);
      if (!selected) {
        return;
      }

      await refreshWorkspace(selected);
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error, 'Failed to open workspace picker.'));
    }
  }

  async function handleReloadWorkspace(): Promise<void> {
    if (!currentRoot) {
      return;
    }

    await refreshWorkspace(currentRoot);
  }

  async function handleOpenSettingsClose(): Promise<void> {
    try {
      await closeCurrentWindow();
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error, 'Failed to close settings window.'));
    }
  }

  async function handleCredentialAction(
    action: () => Promise<CredentialStatus>,
    fallbackMessage: string,
    resetFields = false,
  ): Promise<void> {
    setCredentialsLoading(true);
    setCredentialsError(null);

    try {
      const status = await action();
      setCredentialStatus(status);
      if (resetFields) {
        setVaultPassword('');
        setOpenaiKey('');
        setAnthropicKey('');
      }
    } catch (error) {
      setCredentialsError(formatWorkspaceError(error, fallbackMessage));
    } finally {
      setCredentialsLoading(false);
    }
  }

  async function handleUnlockVault(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await handleCredentialAction(
      () => (credentialStatus.vaultExists ? unlockVault(vaultPassword) : createVault(vaultPassword)),
      credentialStatus.vaultExists ? 'Failed to unlock vault.' : 'Failed to create vault.',
      true,
    );
  }

  async function handleSaveCredentials(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await handleCredentialAction(
      () => saveProviderKeys({ openai: openaiKey, anthropic: anthropicKey }),
      'Failed to save provider keys.',
      true,
    );
  }

  async function handleClearProvider(provider: CredentialSummaryRow['provider']): Promise<void> {
    await handleCredentialAction(
      () => clearProviderKey(provider),
      `Failed to clear ${provider} key.`,
    );
  }

  async function handleLockVault(): Promise<void> {
    await handleCredentialAction(() => lockVault(), 'Failed to lock vault.');
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '16px',
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg-base)',
        boxSizing: 'border-box',
      }}
    >
      <CredentialsSurface
        title="LocalTeam Settings"
        description="Manage provider credentials and the currently selected git workspace for this device."
        statusLabel={statusLabel}
        credentialRows={credentialRows}
        vaultUnlocked={credentialStatus.unlocked}
        vaultExists={credentialStatus.vaultExists}
        loading={credentialsLoading}
        error={credentialsError}
        vaultPassword={vaultPassword}
        openaiKey={openaiKey}
        anthropicKey={anthropicKey}
        canSave={canSave}
        onVaultPasswordChange={setVaultPassword}
        onOpenaiKeyChange={setOpenaiKey}
        onAnthropicKeyChange={setAnthropicKey}
        onUnlockVault={handleUnlockVault}
        onSaveCredentials={handleSaveCredentials}
        onClearProvider={handleClearProvider}
        onLockVault={handleLockVault}
        onClose={() => {
          void handleOpenSettingsClose();
        }}
        unlockButtonLabel={credentialStatus.vaultExists ? 'Unlock Vault' : 'Create Vault'}
        saveButtonLabel={credentialsLoading ? 'Saving…' : 'Save Keys'}
      />

      <ProjectSettingsPanel
        currentRoot={currentRoot}
        onChooseWorkspace={() => {
          void handleChooseWorkspace();
        }}
        onReloadWorkspace={() => {
          void handleReloadWorkspace();
        }}
        loading={workspaceBusy}
        busy={credentialsLoading}
        error={workspaceError}
        config={config}
      />
    </div>
  );
}
