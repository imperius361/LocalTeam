export interface IpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface IpcResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export type IpcMessage = IpcRequest | IpcResponse;

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
