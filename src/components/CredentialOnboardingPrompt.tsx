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
          <h2>Set up agent API keys</h2>
          <p className="settings-copy">
            LocalTeam can store provider keys in its encrypted vault so live agents are ready when
            you need them. You can skip this and continue in mock mode.
          </p>
        </div>
        <span className="settings-chip">One-time prompt</span>
      </div>

      <div className="settings-banner">
        <strong>What happens next?</strong>
        <p>
          Open the Settings window to create or unlock the vault, add any provider keys you want
          stored, and sync them into the runtime. If you skip now, LocalTeam will stop prompting
          on this device until you open Settings manually.
        </p>
      </div>

      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={onSkip}>
          Continue without keys
        </button>
        <button className="primary-button" type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
    </div>
  );
}
