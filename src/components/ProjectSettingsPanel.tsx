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
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Project Settings</h2>
        <span>{currentRoot ?? 'No git workspace selected'}</span>
      </div>
      <p className="settings-copy">
        LocalTeam stores its own settings and runtime state in app data. The selected
        git workspace is the repository LocalTeam operates against.
      </p>
      <div className="settings-grid">
        <div className="workspace-summary">
          <div className="field-group">
            <span>Git workspace</span>
            <strong>{currentRoot ?? 'Choose a workspace to load it'}</strong>
            <small>
              {currentRoot
                ? 'LocalTeam runs tasks against this workspace and keeps its own state outside the repo.'
                : 'Pick the repository you want LocalTeam to open.'}
            </small>
          </div>
          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onChooseWorkspace}
              disabled={loading || busy}
            >
              Choose Git Workspace…
            </button>
            <button
              className="secondary-button"
              type="button"
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
          <strong>{config.team.name}</strong>
          <span>
            {config.team.agents.length} agents • {config.consensus.maxRounds} rounds •{' '}
            {config.sandbox.defaultMode} sandbox
          </span>
        </div>
      )}
    </div>
  );
}
