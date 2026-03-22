interface CredentialOnboardingPromptProps {
  onOpenSettings: () => void;
  onSkip: () => void;
}

export function CredentialOnboardingPrompt({
  onOpenSettings,
  onSkip,
}: CredentialOnboardingPromptProps) {
  return (
    <div className="onboarding-prompt" role="dialog" aria-modal="true">
      <div className="settings-topbar">
        <div>
          <p className="eyebrow">First run</p>
          <h2>Connect Nemoclaw runtime access</h2>
          <p className="settings-copy">
            Nemoclaw manages provider secrets, runtime profiles, and gateway security. Open
            Settings to review the active workspace and runtime bindings before you start a team
            session.
          </p>
        </div>
        <span className="settings-chip">One-time prompt</span>
      </div>

      <div className="settings-banner">
        <strong>What happens next?</strong>
        <p>
          Open the Settings window to inspect gateway status, choose the workspace, and confirm
          which team members still need a Nemoclaw runtime profile ref. If you skip now, LocalTeam
          will stop prompting on this device until you open Settings manually.
        </p>
      </div>

      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={onSkip}>
          Continue without setup
        </button>
        <button
          className="primary-button"
          type="button"
          data-testid="onboarding-open-settings"
          onClick={onOpenSettings}
        >
          Open Settings
        </button>
      </div>
    </div>
  );
}
