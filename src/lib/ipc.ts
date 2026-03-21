import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type {
  CommandApproval,
  ProjectConfig,
  ProjectSnapshot,
  SidecarNotification,
  TaskReviewAction,
} from './contracts';

let requestId = 0;
let initialized = false;
const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }
>();
const subscribers = new Set<(notification: SidecarNotification) => void>();
const WORKSPACE_SELECTED_EVENT = 'localteam://workspace-selected';

export async function initIpc(): Promise<void> {
  if (initialized) {
    return;
  }

  initialized = true;

  await listen<string>('sidecar-stdout', (event) => {
    try {
      const response = JSON.parse(event.payload) as
        | { id: string; result?: unknown; error?: { message: string } }
        | SidecarNotification;
      if ('id' in response) {
        const pending = pendingRequests.get(response.id);
        if (pending) {
          pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
        return;
      }

      notifySubscribers(response);
    } catch {
      console.error('Failed to parse sidecar response:', event.payload);
    }
  });

  await listen<string>('sidecar-started', () => {
    notifySubscribers({
      method: 'v1.sidecar.started',
      params: {},
    });
  });

  await listen<string>('sidecar-terminated', (event) => {
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('Sidecar terminated'));
      pendingRequests.delete(id);
    }

    notifySubscribers({
      method: 'v1.sidecar.terminated',
      params: { detail: event.payload },
    });
  });
}

export function subscribeToNotifications(
  handler: (notification: SidecarNotification) => void,
): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

export async function callSidecar<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (method === 'v1.credentials.sync') {
    throw new Error(
      'v1.credentials.sync is blocked from the webview. Use Rust credential commands.',
    );
  }

  const id = String(++requestId);
  const message = JSON.stringify({ id, method, params });

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    invoke('send_to_sidecar', { message }).catch((err) => {
      pendingRequests.delete(id);
      reject(err);
    });
  });
}

export async function restartSidecar(): Promise<void> {
  await invoke('restart_sidecar');
}

export async function openSettingsWindow(): Promise<void> {
  await invoke('open_settings_window');
}

export function isSettingsWindow(): boolean {
  try {
    return getCurrentWebviewWindow().label === 'settings';
  } catch {
    return false;
  }
}

export async function closeCurrentWindow(): Promise<void> {
  await getCurrentWebviewWindow().close();
}

export async function pickProjectFolder(
  startingDirectory?: string,
): Promise<string | null> {
  return invoke<string | null>('pick_project_folder', {
    ...(startingDirectory ? { startingDirectory } : {}),
  });
}

export async function loadProjectSnapshot(
  rootPath?: string,
): Promise<ProjectSnapshot> {
  return callSidecar<ProjectSnapshot>('v1.project.load', {
    ...(rootPath ? { rootPath } : {}),
  });
}

export async function getStatusSnapshot(): Promise<ProjectSnapshot> {
  return callSidecar<ProjectSnapshot>('v1.status');
}

export async function saveProjectConfig(config: ProjectConfig): Promise<ProjectSnapshot> {
  return callSidecar<ProjectSnapshot>('v1.project.save', { config });
}

export async function listCommandApprovals(
  taskId?: string,
): Promise<CommandApproval[]> {
  return callSidecar<CommandApproval[]>('v1.command.approval.list', {
    ...(taskId ? { taskId } : {}),
  });
}

export async function resolveCommandApproval(
  approvalId: string,
  action: 'approve' | 'deny',
): Promise<CommandApproval> {
  return callSidecar<CommandApproval>('v1.command.approval.resolve', {
    approvalId,
    action,
  });
}

export async function sendTaskGuidance(
  taskId: string,
  guidance?: string,
): Promise<ProjectSnapshot> {
  return callSidecar<ProjectSnapshot>('v1.task.interject', {
    taskId,
    ...(guidance ? { guidance } : {}),
  });
}

export async function respondToTaskReview(
  taskId: string,
  action: TaskReviewAction,
  guidance?: string,
): Promise<ProjectSnapshot> {
  return callSidecar<ProjectSnapshot>('v1.task.review.respond', {
    taskId,
    action,
    ...(typeof guidance === 'string' ? { guidance } : {}),
  });
}

export async function subscribeToWorkspaceSelections(
  handler: (rootPath: string) => void,
): Promise<() => void> {
  return listen<{ rootPath: string }>(WORKSPACE_SELECTED_EVENT, (event) => {
    const rootPath = typeof event.payload?.rootPath === 'string' ? event.payload.rootPath : '';
    if (rootPath) {
      handler(rootPath);
    }
  });
}

function notifySubscribers(notification: SidecarNotification): void {
  for (const subscriber of subscribers) {
    subscriber(notification);
  }
}
