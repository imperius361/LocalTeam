import type { ProjectConfig } from '../lib/contracts';

interface ProjectSettingsPanelProps {
  currentRoot: string | null;
  onChooseWorkspace: () => void;
  onReloadWorkspace: () => void;
  loading: boolean;
  busy: boolean;
  error: string | null;
  config: ProjectConfig | null;
}

export function ProjectSettingsPanel({
  currentRoot,
  onChooseWorkspace,
  onReloadWorkspace,
  loading,
  busy,
  error,
  config,
}: ProjectSettingsPanelProps) {
  const teams = config?.teams ?? [];
  const members = teams.flatMap((team) => team.members);
  const boundMembers = members.filter((member) => member.runtimeProfileRef).length;
  const defaultTeamName = teams.find((team) => team.id === config?.defaultTeamId)?.name
    ?? teams[0]?.name
    ?? 'No default team selected';

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Project Settings</h2>
        <span>{currentRoot ?? 'No git workspace selected'}</span>
      </div>
      <p className="settings-copy">
        LocalTeam stores workspace selection and team definitions locally. Nemoclaw manages the
        secure runtime, model-provider access, and secret material outside the repository.
      </p>
      <div className="settings-grid">
        <div className="workspace-summary">
          <div className="field-group">
            <span>Git workspace</span>
            <strong>{currentRoot ?? 'Choose a workspace to load it'}</strong>
            <small>
              {currentRoot
                ? 'Teams share this project workspace by default while each member binds to a Nemoclaw runtime profile.'
                : 'Pick the repository you want LocalTeam to open.'}
            </small>
          </div>
          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              data-testid="settings-choose-workspace"
              onClick={onChooseWorkspace}
              disabled={loading || busy}
            >
              Choose Git Workspace…
            </button>
            <button
              className="secondary-button"
              type="button"
              data-testid="settings-reload-workspace"
              onClick={onReloadWorkspace}
              disabled={loading || busy || !currentRoot}
            >
              Reload Workspace
            </button>
          </div>
        </div>
      </div>
      {error && <p className="recovery-copy settings-error">{error}</p>}
      {config && (
        <div className="project-summary readonly">
          <strong>{defaultTeamName}</strong>
          <span>
            {teams.length} team{teams.length === 1 ? '' : 's'} • {members.length} member
            {members.length === 1 ? '' : 's'} • {boundMembers} bound •{' '}
            {config.sandbox.defaultMode} sandbox
          </span>
        </div>
      )}
    </div>
  );
}
