import { describe, it, expect } from 'vitest';
import {
  encodeMessage,
  decodeMessage,
  type IpcRequest,
  type IpcResponse,
} from '../src/protocol';

describe('IPC Protocol', () => {
  it('encodes a request to a JSON line', () => {
    const req: IpcRequest = {
      id: '1',
      method: 'ping',
      params: {},
    };
    const encoded = encodeMessage(req);
    expect(encoded).toBe('{"id":"1","method":"ping","params":{}}\n');
  });

  it('decodes a JSON line to a request', () => {
    const line = '{"id":"1","method":"ping","params":{}}\n';
    const decoded = decodeMessage(line);
    expect(decoded).toEqual({
      id: '1',
      method: 'ping',
      params: {},
    });
  });

  it('encodes a response to a JSON line', () => {
    const res: IpcResponse = {
      id: '1',
      result: { status: 'ok' },
    };
    const encoded = encodeMessage(res);
    expect(encoded).toBe('{"id":"1","result":{"status":"ok"}}\n');
  });

  it('throws on invalid JSON', () => {
    expect(() => decodeMessage('not json\n')).toThrow();
  });
});
