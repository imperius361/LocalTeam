import { invoke } from '@tauri-apps/api/core';

export interface RuntimeContext {
  e2eMode: boolean;
  scenario: string | null;
  workspace: string | null;
}

declare global {
  interface Window {
    __LOCALTEAM_E2E__?: {
      context: RuntimeContext;
      emitWorkspaceSelected: (rootPath?: string) => Promise<void>;
      triggerSidecarTermination: (detail?: string) => Promise<void>;
      shutdownApp: () => Promise<void>;
    };
  }
}

let runtimeContextPromise: Promise<RuntimeContext> | null = null;

export async function getRuntimeContext(): Promise<RuntimeContext> {
  if (!runtimeContextPromise) {
    runtimeContextPromise = invoke<RuntimeContext>('get_runtime_context').catch(() => ({
      e2eMode: false,
      scenario: null,
      workspace: null,
    }));
  }

  return runtimeContextPromise;
}

export async function emitTestWorkspaceSelected(rootPath?: string): Promise<void> {
  await invoke('emit_test_workspace_selected', {
    ...(rootPath ? { rootPath } : {}),
  });
}

export async function triggerTestSidecarTermination(detail?: string): Promise<void> {
  await invoke('trigger_test_sidecar_termination', {
    ...(detail ? { detail } : {}),
  });
}

export async function shutdownTestApp(): Promise<void> {
  await invoke('shutdown_test_app');
}
