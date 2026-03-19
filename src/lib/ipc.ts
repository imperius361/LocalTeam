import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

let requestId = 0;
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}>();

export async function initIpc(): Promise<void> {
  await listen<string>('sidecar-stdout', (event) => {
    try {
      const response = JSON.parse(event.payload);
      const pending = pendingRequests.get(response.id);
      if (pending) {
        pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      console.error('Failed to parse sidecar response:', event.payload);
    }
  });

  await listen<string>('sidecar-terminated', () => {
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('Sidecar terminated'));
      pendingRequests.delete(id);
    }
  });
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
