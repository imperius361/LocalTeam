import { useEffect } from 'react';

import { useTheme } from './themes/ThemeContext';
import { useNav } from './navigation/NavContext';
import { useAppStore } from './store/appStore';
import { initIpc, subscribeToNotifications } from './lib/ipc';
import type { SidecarNotification } from './lib/contracts';

import { ThemeSelector } from './components/ThemeSelector';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { LayerTransition } from './components/common/LayerTransition';
import { GlobalView } from './components/layers/GlobalView';
import { ProjectView } from './components/layers/ProjectView';
import { TeamView } from './components/layers/TeamView';
import { AgentView } from './components/layers/AgentView';

import './App.css';

function IpcSubscriber() {
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const upsertAgentStatus = useAppStore((s) => s.upsertAgentStatus);
  const upsertTask = useAppStore((s) => s.upsertTask);
  const appendMessage = useAppStore((s) => s.appendMessage);

  useEffect(() => {
    initIpc(); // initialize Tauri event listeners for sidecar-stdout, sidecar-started, sidecar-terminated
    const unsub = subscribeToNotifications((notification: SidecarNotification) => {
      // Trust sidecar message shapes — params is Record<string, unknown> from IPC JSON
      const { method, params } = notification;

      if (method === 'v1.snapshot' && params.snapshot) {
        setSnapshot(params.snapshot as Parameters<typeof setSnapshot>[0]);
      } else if (method === 'v1.agent.status' && params.status) {
        upsertAgentStatus(params.status as Parameters<typeof upsertAgentStatus>[0]);
      } else if (method === 'v1.task.updated' && params.task) {
        upsertTask(params.task as Parameters<typeof upsertTask>[0]);
      } else if (method === 'v1.message' && params.message) {
        appendMessage(params.message as Parameters<typeof appendMessage>[0]);
      }
    });
    return unsub;
  }, [setSnapshot, upsertAgentStatus, upsertTask, appendMessage]);

  return null;
}

export default function App(): React.ReactElement {
  const { theme } = useTheme();
  const { navState } = useNav();

  if (theme === null) {
    return <ThemeSelector />;
  }

  const showSidebar = navState.layer !== 'global';

  return (
    <div data-theme={theme} className="app-root">
      <IpcSubscriber />
      <Topbar />
      <div className="app-body">
        {showSidebar && <Sidebar />}
        <main className="app-main">
          <LayerTransition layerKey={navState.layer}>
            {navState.layer === 'global' && <GlobalView />}
            {navState.layer === 'project' && <ProjectView />}
            {navState.layer === 'team' && <TeamView />}
            {navState.layer === 'agent' && <AgentView />}
          </LayerTransition>
        </main>
      </div>
    </div>
  );
}
