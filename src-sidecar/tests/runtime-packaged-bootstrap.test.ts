import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalTeamRuntime } from '../src/runtime';
import { resolveWorkspaceStorageRoot } from '../src/persistence';
import type { AgentConfig, ProjectConfig } from '../src/types';
import {
  createAppDataDir,
  createGitWorkspace,
} from './helpers';

const packagedTemplate = {
  name: 'Default LocalTeam',
  agents: [
    {
      id: 'architect',
      role: 'Software Architect',
      model: 'gpt-4.1-mini',
      provider: 'openai',
      systemPrompt: 'Lead the team.',
    },
  ] satisfies AgentConfig[],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('LocalTeamRuntime packaged-first-run bootstrap', () => {
  it('starts with no selected project when no default workspace is configured', async () => {
    const root = await createGitWorkspace('localteam-packaged-empty-');
    const appDataDir = await createAppDataDir('localteam-packaged-empty-app-data-');
    await mkdir(join(root, 'templates'), { recursive: true });
    await writeFile(
      join(root, 'templates', 'default-team.json'),
      JSON.stringify(packagedTemplate, null, 2),
      'utf8',
    );

    vi.stubEnv('LOCALTEAM_APP_DATA_DIR', appDataDir);
    vi.stubEnv('LOCALTEAM_TEMPLATES_DIR', join(root, 'templates'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(appDataDir);

    const runtime = new LocalTeamRuntime(() => {});

    try {
      const snapshot = await runtime.loadProject();
      expect(snapshot.projectRoot).toBeNull();
      expect(snapshot.config).toBeNull();
      expect(snapshot.session).toBeNull();
      expect(snapshot.tasks).toHaveLength(0);
    } finally {
      runtime.dispose();
      cwdSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
      await rm(appDataDir, { recursive: true, force: true });
    }
  });

  it('bootstraps config and database in app data for an explicitly configured workspace', async () => {
    const root = await createGitWorkspace('localteam-bootstrap-');
    const appDataDir = await createAppDataDir('localteam-bootstrap-app-data-');
    const templatesDir = join(appDataDir, 'templates');
    await mkdir(templatesDir, { recursive: true });
    await writeFile(
      join(templatesDir, 'default-team.json'),
      JSON.stringify(packagedTemplate, null, 2),
      'utf8',
    );

    vi.stubEnv('LOCALTEAM_APP_DATA_DIR', appDataDir);
    vi.stubEnv('LOCALTEAM_DEFAULT_PROJECT_ROOT', root);
    vi.stubEnv('LOCALTEAM_TEMPLATES_DIR', templatesDir);

    const runtime = new LocalTeamRuntime(() => {});

    try {
      const snapshot = await runtime.loadProject();
      expect(snapshot.projectRoot).toBe(root);
      expect(snapshot.config).toMatchObject<ProjectConfig>({
        team: {
          name: 'Default LocalTeam',
          agents: packagedTemplate.agents,
        },
        consensus: {
          maxRounds: 3,
          requiredMajority: 0.66,
        },
        sandbox: {
          defaultMode: 'direct',
          useWorktrees: true,
        },
        fileAccess: {
          denyList: ['.env', '.ssh/', 'credentials*'],
        },
      });

      const appDataConfig = join(
        resolveWorkspaceStorageRoot(root),
        'project-config.json',
      );
      const configFromAppData = JSON.parse(await readFile(appDataConfig, 'utf8')) as ProjectConfig;
      expect(configFromAppData.team.name).toBe('Default LocalTeam');
      expect(configFromAppData.team.agents).toHaveLength(1);

      await expect(access(join(root, 'localteam.json'))).rejects.toThrow();
      await expect(access(join(root, '.localteam', 'localteam.db'))).rejects.toThrow();
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(appDataDir, { recursive: true, force: true });
    }
  });
});
