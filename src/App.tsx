import { lazy, Suspense, useEffect } from 'react';

import { useTheme } from './themes/ThemeContext';
import { useNav } from './navigation/NavContext';
import { useAppStore } from './store/appStore';
import { getStatusSnapshot, initIpc, isSettingsWindow, loadProjectSnapshot, subscribeToNotifications, subscribeToWorkspaceSelections } from './lib/ipc';
import type { SidecarNotification } from './lib/contracts';
import { createOfflineSnapshot, formatWorkspaceError, loadAndStoreWorkspace } from './lib/workspace';

import { ThemeSelector } from './components/ThemeSelector';
import { SettingsWindow } from './components/SettingsWindow';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { LayerTransition } from './components/common/LayerTransition';
import { GlobalView } from './components/layers/GlobalView';

import './App.css';

const ProjectView = lazy(async () => {
  const module = await import('./components/layers/ProjectView');
  return { default: module.ProjectView };
});

const TeamView = lazy(async () => {
  const module = await import('./components/layers/TeamView');
  return { default: module.TeamView };
});

const AgentView = lazy(async () => {
  const module = await import('./components/layers/AgentView');
  return { default: module.AgentView };
});

function IpcSubscriber() {
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const patchSnapshot = useAppStore((s) => s.patchSnapshot);
  const upsertAgentStatus = useAppStore((s) => s.upsertAgentStatus);
  const upsertTask = useAppStore((s) => s.upsertTask);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const upsertLiveMessageDelta = useAppStore((s) => s.upsertLiveMessageDelta);
  const finalizeLiveMessageDelta = useAppStore((s) => s.finalizeLiveMessageDelta);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    const refreshSnapshot = async (): Promise<void> => {
      try {
        const snapshot = await getStatusSnapshot();
        if (!disposed) {
          setSnapshot(snapshot);
        }
      } catch (error) {
        if (!disposed) {
          setSnapshot(
            createOfflineSnapshot(
              formatWorkspaceError(error, 'Sidecar is not available.'),
            ),
          );
        }
      }
    };

    void (async () => {
      try {
        await initIpc();
        if (disposed) {
          return;
        }

        unsubscribe = subscribeToNotifications((notification: SidecarNotification) => {
          const { method, params } = notification;

          if (method === 'v1.snapshot' && params.snapshot) {
            setSnapshot(params.snapshot as Parameters<typeof setSnapshot>[0]);
            return;
          }

          if (method === 'v1.sidecar.started') {
            void refreshSnapshot();
            return;
          }

          if (method === 'v1.sidecar.terminated') {
            const detail =
              typeof params.detail === 'string' ? params.detail : 'Sidecar terminated.';
            setSnapshot(createOfflineSnapshot(detail));
            return;
          }

          if (method === 'v1.agent.updated' && params.agent) {
            upsertAgentStatus(params.agent as Parameters<typeof upsertAgentStatus>[0]);
            return;
          }

          if (method === 'v1.task.updated' && params.task) {
            upsertTask(params.task as Parameters<typeof upsertTask>[0]);
            return;
          }

          if (method === 'v1.session.message' && params.message) {
            appendMessage(params.message as Parameters<typeof appendMessage>[0]);
            return;
          }

          if (method === 'v1.session.message.delta' && params.delta) {
            upsertLiveMessageDelta(
              params.delta as Parameters<typeof upsertLiveMessageDelta>[0],
            );
            return;
          }

          if (method === 'v1.session.message.finalized' && params.finalization) {
            const finalization =
              params.finalization as { messageId?: string };
            if (typeof finalization.messageId === 'string') {
              finalizeLiveMessageDelta(finalization.messageId);
            }
            return;
          }

          if (method === 'v1.session.updated' && params.session) {
            patchSnapshot((snapshot) =>
              snapshot
                ? {
                    ...snapshot,
                    session: params.session as typeof snapshot.session,
                  }
                : snapshot,
            );
            return;
          }

          if (method === 'v1.credentials.updated' && params.credentials) {
            patchSnapshot((snapshot) =>
              snapshot
                ? {
                    ...snapshot,
                    credentials: params.credentials as typeof snapshot.credentials,
                  }
                : snapshot,
            );
            return;
          }

          if (method === 'v1.consensus.updated' && params.consensus) {
            patchSnapshot((snapshot) => {
              if (!snapshot) {
                return snapshot;
              }

              const consensusEntry = params.consensus as (typeof snapshot.consensus)[number];
              const existing = snapshot.consensus.filter(
                (entry) => entry.taskId !== consensusEntry.taskId,
              );
              return {
                ...snapshot,
                consensus: [...existing, consensusEntry].sort(
                  (left, right) => left.updatedAt - right.updatedAt,
                ),
              };
            });
            return;
          }

          if (
            (method === 'v1.command.approval.updated' ||
              method === 'v1.command.approval.required') &&
            params.approval
          ) {
            patchSnapshot((snapshot) => {
              if (!snapshot) {
                return snapshot;
              }

              const approval = params.approval as (typeof snapshot.commandApprovals)[number];
              const existing = snapshot.commandApprovals.filter(
                (entry) => entry.id !== approval.id,
              );
              return {
                ...snapshot,
                commandApprovals: [...existing, approval].sort(
                  (left, right) => left.requestedAt - right.requestedAt,
                ),
              };
            });
            return;
          }

          if (method === 'v1.project.external_change') {
            void refreshSnapshot();
          }
        });

        await refreshSnapshot();
      } catch (error) {
        if (!disposed) {
          setSnapshot(
            createOfflineSnapshot(
              formatWorkspaceError(error, 'Failed to initialize sidecar listeners.'),
            ),
          );
        }
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    appendMessage,
    finalizeLiveMessageDelta,
    patchSnapshot,
    setSnapshot,
    upsertAgentStatus,
    upsertLiveMessageDelta,
    upsertTask,
  ]);

  return null;
}

function DashboardShell(): React.ReactElement {
  const { navState } = useNav();

  const showSidebar = navState.layer !== 'global';

  return (
    <>
      <Topbar />
      <div className="app-body">
        {showSidebar && <Sidebar />}
        <main className="app-main">
          <Suspense fallback={<ViewLoadingFallback />}>
            <LayerTransition layerKey={navState.layer}>
              {navState.layer === 'global' && <GlobalView />}
              {navState.layer === 'project' && <ProjectView />}
              {navState.layer === 'team' && <TeamView />}
              {navState.layer === 'agent' && <AgentView />}
            </LayerTransition>
          </Suspense>
        </main>
      </div>
    </>
  );
}

function ViewLoadingFallback(): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-muted)',
        fontSize: '11px',
        letterSpacing: '1px',
        textTransform: 'uppercase',
      }}
    >
      Loading view
    </div>
  );
}

function WorkspaceSelectionSubscriber(): null {
  const settingsWindow = isSettingsWindow();
  const { navigate } = useNav();
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const addRecentProject = useAppStore((s) => s.addRecentProject);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);

  useEffect(() => {
    if (settingsWindow) {
      return undefined;
    }

    let unsubscribe = () => {};

    void (async () => {
      unsubscribe = await subscribeToWorkspaceSelections((rootPath) => {
        void (async () => {
          try {
            const snapshot = await loadAndStoreWorkspace(rootPath, {
              loadProjectSnapshot,
              setSnapshot,
              addRecentProject,
              setActiveProjectPath,
            });
            if (snapshot.projectRoot) {
              navigate({ layer: 'project', projectPath: snapshot.projectRoot });
            }
          } catch (error) {
            console.error('Failed to open workspace from native menu:', error);
          }
        })();
      });
    })();

    return () => {
      unsubscribe();
    };
  }, [addRecentProject, navigate, setActiveProjectPath, setSnapshot, settingsWindow]);

  return null;
}

export function AppWindowContent(): React.ReactElement {
  if (isSettingsWindow()) {
    return <SettingsWindow />;
  }

  return <DashboardShell />;
}

export default function App(): React.ReactElement {
  const { theme } = useTheme();

  if (theme === null) {
    return (
      <>
        <IpcSubscriber />
        <WorkspaceSelectionSubscriber />
        <ThemeSelector />
      </>
    );
  }

  return (
    <div data-theme={theme} className="app-root">
      <IpcSubscriber />
      <WorkspaceSelectionSubscriber />
      <AppWindowContent />
    </div>
  );
}
