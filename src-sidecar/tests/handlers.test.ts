import { describe, it, expect } from 'vitest';
import { handleRequest } from '../src/handlers';

describe('Request Handlers', () => {
  it('responds to ping with pong', () => {
    const res = handleRequest({ id: '1', method: 'ping', params: {} });
    expect(res.result).toEqual({ status: 'pong' });
    expect(res.error).toBeUndefined();
  });

  it('echoes params back', () => {
    const params = { message: 'hello' };
    const res = handleRequest({ id: '2', method: 'echo', params });
    expect(res.result).toEqual(params);
  });

  it('responds to status with sidecar info', () => {
    const res = handleRequest({ id: '3', method: 'status', params: {} });
    expect(res.result).toHaveProperty('uptime');
    expect(res.result).toHaveProperty('version');
  });

  it('returns error for unknown method', () => {
    const res = handleRequest({ id: '4', method: 'nonexistent', params: {} });
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain('Unknown method');
  });
});
