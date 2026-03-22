import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NemoclawGatewayBridge } from '../src/gateway-bridge';
import { createAppDataDir } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('NemoclawGatewayBridge', () => {
  it('reads gateway status and runtime profiles from Nemoclaw state', async () => {
    const appDataDir = await createAppDataDir('localteam-gateway-bridge-');
    const statePath = join(appDataDir, 'nemoclaw-state.json');

    try {
      await mkdir(appDataDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify(
          {
            onboardingCompleted: true,
            updatedAt: 1234,
            profiles: [
              {
                id: 'profiles/local',
                label: 'Local',
                provider: 'nemoclaw',
                model: 'openclaw-local',
                availability: 'ready',
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      vi.stubEnv('LOCALTEAM_APP_DATA_DIR', appDataDir);

      const bridge = new NemoclawGatewayBridge();
      const status = await bridge.getStatus('/repo');
      const profiles = await bridge.listProfiles();
      const applied = await bridge.applyTeam('team-a');
      const session = await bridge.startSession('team-a', 'Team A', [
        {
          id: 'architect',
          role: 'Architect',
          canExecuteCommands: true,
        },
      ]);
      const approvals = bridge.listApprovals();
      const resolved = await bridge.resolveApproval(approvals[0]!.id, 'approve');
      const stopped = await bridge.stopSession(session.id);

      expect(status.ready).toBe(true);
      expect(status.profileCount).toBe(1);
      expect(status.workspaceRoot).toBe('/repo');
      expect(profiles[0]?.id).toBe('profiles/local');
      expect(applied.teamId).toBe('team-a');
      expect(bridge.getActiveTeamId()).toBe('team-a');
      expect(session.teamId).toBe('team-a');
      expect(approvals).toHaveLength(1);
      expect(approvals[0]?.agentId).toBe('architect');
      expect(resolved?.status).toBe('approved');
      expect(stopped?.status).toBe('stopped');
      expect(bridge.listSessions()).toHaveLength(1);
      expect(bridge.listEvents(session.id)).toHaveLength(4);
    } finally {
      await rm(appDataDir, { recursive: true, force: true });
    }
  });

  it('falls back to an empty state when Nemoclaw state is missing', async () => {
    const bridge = new NemoclawGatewayBridge();
    const status = await bridge.getStatus(null);

    expect(status.ready).toBe(false);
    expect(status.profileCount).toBe(0);
    expect(status.workspaceRoot).toBeNull();
    expect(await bridge.listProfiles()).toEqual([]);
  });
});
