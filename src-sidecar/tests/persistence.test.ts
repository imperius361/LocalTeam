import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectDatabase,
  resolveWorkspaceDatabasePath,
} from '../src/persistence';
import type { CommandApproval } from '../src/types';
import { createAppDataDir } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('ProjectDatabase command approval persistence', () => {
  it('saves and reloads command approvals', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'localteam-sidecar-'));
    const appDataDir = await createAppDataDir('localteam-sidecar-app-data-');
    vi.stubEnv('LOCALTEAM_APP_DATA_DIR', appDataDir);
    try {
      const db = await ProjectDatabase.open(rootPath);
      const dbPath = resolveWorkspaceDatabasePath(rootPath);
      const approval: CommandApproval = {
        id: 'approval-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        agentRole: 'Engineer',
        command: 'git status',
        requestedCwd: '.',
        effectiveCwd: rootPath,
        status: 'pending',
        requiresApproval: true,
        preApproved: false,
        requestedAt: 1,
        updatedAt: 1,
        policy: {
          sandboxMode: 'direct',
          checkedPaths: [rootPath],
          allowedPaths: ['src'],
        },
      };

      await db.saveCommandApproval(approval);
      const loaded = await db.loadState();

      expect(loaded.commandApprovals).toHaveLength(1);
      expect(loaded.commandApprovals[0].id).toBe('approval-1');
      expect(loaded.commandApprovals[0].policy.sandboxMode).toBe('direct');
      expect(dbPath.startsWith(appDataDir)).toBe(true);
      await expect(access(join(rootPath, '.localteam', 'localteam.db'))).rejects.toThrow();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
      await rm(appDataDir, { recursive: true, force: true });
    }
  });
});
