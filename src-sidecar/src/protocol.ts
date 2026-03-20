export interface IpcRequest<T = Record<string, unknown>> {
  id: string;
  method: string;
  params: T;
}

export interface IpcResponse<T = unknown> {
  id: string;
  result?: T;
  error?: { code: number; message: string };
}

export interface IpcNotification<T = Record<string, unknown>> {
  method: string;
  params: T;
}

export type IpcMessage = IpcRequest | IpcResponse | IpcNotification;

export function emitNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  process.stdout.write(encodeMessage({ method, params }));
}

export function isNotification(message: IpcMessage): message is IpcNotification {
  return !('id' in message);
}

export function encodeMessage(msg: IpcMessage): string {
  return JSON.stringify(msg) + '\n';
}

export function decodeMessage(line: string): IpcMessage {
  const trimmed = line.trim();
  try {
    return JSON.parse(trimmed) as IpcMessage;
  } catch {
    throw new Error(`Invalid IPC message: ${trimmed}`);
  }
}
