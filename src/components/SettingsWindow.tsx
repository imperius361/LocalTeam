import React, { useMemo, useState } from 'react';

import { useAppStore } from '../store/appStore';
import {
  closeCurrentWindow,
  getStatusSnapshot,
  loadProjectSnapshot,
  pickProjectFolder,
} from '../lib/ipc';
import { formatWorkspaceError, loadAndStoreWorkspace } from '../lib/workspace';
import { launchNemoclawOnboarding } from '../lib/nemoclaw';

import type { CredentialSummaryRow } from './CredentialsSummaryPanel';
import { CredentialsSurface } from './CredentialsSurface';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';

export function SettingsWindow(): React.ReactElement {
  const snapshot = useAppStore((s) => s.snapshot);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const addRecentProject = useAppStore((s) => s.addRecentProject);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const currentRoot = snapshot?.projectRoot ?? null;
  const config = snapshot?.config ?? null;
  const teams = config?.teams ?? [];
  const members = teams.flatMap((team) => team.members);

  const credentialRows = useMemo<CredentialSummaryRow[]>(() => {
    const runtimeProfiles = new Map(
      (snapshot?.runtimeProfiles ?? []).map((profile) => [profile.id, profile]),
    );
    const groups = new Map<string, CredentialSummaryRow>();

    for (const member of members) {
      const runtimeRef = member.runtimeProfileRef?.trim() || null;
      const runtimeProfile = runtimeRef ? runtimeProfiles.get(runtimeRef) : null;
      const fallbackLabel = member.runtimeHint?.provider || member.runtimeHint?.model
        ? `${member.runtimeHint?.provider ?? 'provider'} / ${member.runtimeHint?.model ?? 'model'}`
        : 'Unbound runtime profile';
      const key = runtimeRef ?? `unbound:${member.id}`;
      const existing = groups.get(key);
      const nextState: CredentialSummaryRow['state'] = runtimeRef
        ? runtimeProfile?.availability === 'ready'
          ? 'connected'
          : 'configured'
        : 'unbound';

      if (existing) {
        existing.assignedMembers += 1;
        existing.detail = `${existing.assignedMembers} members`;
        if (existing.state !== 'connected' && nextState === 'connected') {
          existing.state = 'connected';
        } else if (existing.state === 'unbound' && nextState === 'configured') {
          existing.state = 'configured';
        }
        continue;
      }

      groups.set(key, {
        id: key,
        label: runtimeProfile?.label ?? runtimeRef ?? fallbackLabel,
        assignedMembers: 1,
        state: nextState,
        detail: runtimeRef
          ? runtimeProfile
            ? `${runtimeProfile.provider} / ${runtimeProfile.model} • 1 member`
            : '1 member'
          : member.runtimeHint?.provider || member.runtimeHint?.model
            ? `Needs profile binding (${fallbackLabel})`
            : 'Needs runtime profile binding',
      });
    }

    return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [members, snapshot?.runtimeProfiles]);

  const runtimeStats = useMemo(
    () => [
      {
        label: 'Gateway bridge',
        value: snapshot?.gateway?.ready ? 'Online' : 'Pending onboarding',
      },
      {
        label: 'Configured teams',
        value: String(teams.length),
      },
      {
        label: 'Runtime profiles',
        value: String(snapshot?.runtimeProfiles?.length ?? 0),
      },
      {
        label: 'Active team',
        value:
          teams.find((team) => team.id === snapshot?.activeTeamId)?.name ??
          snapshot?.activeTeamId ??
          'None',
      },
      {
        label: 'Live sessions',
        value: String(snapshot?.sessions?.length ?? 0),
      },
      {
        label: 'Pending approvals',
        value: String(
          (snapshot?.approvals ?? []).filter((approval) => approval.status === 'pending').length,
        ),
      },
    ],
    [
      snapshot?.activeTeamId,
      snapshot?.approvals,
      snapshot?.gateway?.ready,
      snapshot?.runtimeProfiles,
      snapshot?.sessions,
      teams,
    ],
  );

  const statusLabel = snapshot?.gateway?.ready ? 'Gateway online' : 'Gateway needs onboarding';

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

  async function handleLaunchRuntimeOnboarding(): Promise<void> {
    setRuntimeBusy(true);
    setRuntimeError(null);

    try {
      await launchNemoclawOnboarding();
      const refreshed = currentRoot
        ? await loadProjectSnapshot(currentRoot)
        : await getStatusSnapshot();
      setSnapshot(refreshed);
    } catch (error) {
      setRuntimeError(formatWorkspaceError(error, 'Failed to initialize Nemoclaw.'));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function handleOpenSettingsClose(): Promise<void> {
    try {
      await closeCurrentWindow();
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error, 'Failed to close settings window.'));
    }
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
        title="LocalTeam Runtime Settings"
        description="Nemoclaw/OpenClaw owns secret storage and model-provider access. LocalTeam manages workspace selection and team-to-runtime bindings."
        statusLabel={statusLabel}
        credentialRows={credentialRows}
        loading={workspaceBusy || runtimeBusy}
        error={runtimeError}
        runtimeStats={runtimeStats}
        runtimeActionLabel={
          snapshot?.gateway?.onboardingCompleted ? 'Re-run Onboarding' : 'Initialize Runtime'
        }
        runtimeActionDisabled={runtimeBusy}
        onRuntimeAction={() => {
          void handleLaunchRuntimeOnboarding();
        }}
        onClose={() => {
          void handleOpenSettingsClose();
        }}
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
        busy={false}
        error={workspaceError}
        config={config}
      />
    </div>
  );
}
