import { describe, expect, it, vi } from 'vitest';

const { openSettingsWindow } = vi.hoisted(() => ({
  openSettingsWindow: vi.fn(async () => {}),
}));

vi.mock('../../src/lib/ipc', () => ({
  openSettingsWindow,
}));

import { handleTopbarSettingsClick } from '../../src/components/Topbar';

describe('Topbar settings action', () => {
  it('opens the dedicated settings window instead of resetting the theme', async () => {
    await handleTopbarSettingsClick();
    expect(openSettingsWindow).toHaveBeenCalledTimes(1);
  });
});
