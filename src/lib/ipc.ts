import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ProjectSnapshot, SidecarNotification } from './contracts';

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

export async function loadProjectSnapshot(): Promise<ProjectSnapshot> {
  return callSidecar<ProjectSnapshot>('v1.project.load', { rootPath: '.' });
}

function notifySubscribers(notification: SidecarNotification): void {
  for (const subscriber of subscribers) {
    subscriber(notification);
  }
}
