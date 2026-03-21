import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ProviderId = 'openai' | 'anthropic';

export type ProviderCredentialStatus = {
  provider: ProviderId;
  hasKey: boolean;
};

export type CredentialStatus = {
  unlocked: boolean;
  vaultExists: boolean;
  providers: ProviderCredentialStatus[];
};

export type CredentialOnboardingStatus = {
  apiKeyPromptDismissed: boolean;
  hasSavedKeys: boolean;
  shouldPromptForApiKeys: boolean;
};

export type ProviderValues = Partial<Record<ProviderId, string>>;

export type CredentialEvent =
  | { type: 'status'; status: CredentialStatus }
  | { type: 'onboarding'; onboarding: CredentialOnboardingStatus };

const CREDENTIAL_STATUS_EVENT = 'localteam://credential-status-changed';
const CREDENTIAL_ONBOARDING_EVENT = 'localteam://credential-onboarding-changed';

export async function createVault(password: string): Promise<CredentialStatus> {
  return invoke<CredentialStatus>('credentials_create_vault', { password });
}

export async function unlockVault(password: string): Promise<CredentialStatus> {
  return invoke<CredentialStatus>('credentials_unlock_vault', { password });
}

export async function lockVault(): Promise<CredentialStatus> {
  return invoke<CredentialStatus>('credentials_lock_vault');
}

export async function saveProviderKeys(values: ProviderValues): Promise<CredentialStatus> {
  let latest = await getCredentialStatus();
  for (const provider of ['openai', 'anthropic'] as const) {
    const value = values[provider];
    if (typeof value === 'string' && value.trim()) {
      latest = await invoke<CredentialStatus>('credentials_set_provider_key', {
        provider,
        value,
      });
    }
  }

  return latest;
}

export async function clearProviderKey(provider: ProviderId): Promise<CredentialStatus> {
  return invoke<CredentialStatus>('credentials_clear_provider_key', { provider });
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  return invoke<CredentialStatus>('credentials_get_status');
}

export async function getCredentialOnboardingState(): Promise<CredentialOnboardingStatus> {
  return invoke<CredentialOnboardingStatus>('credentials_get_onboarding_state');
}

export async function dismissApiKeyPrompt(): Promise<CredentialOnboardingStatus> {
  return invoke<CredentialOnboardingStatus>('credentials_dismiss_api_key_prompt');
}

export async function syncCredentialsToSidecar(): Promise<CredentialStatus> {
  return invoke<CredentialStatus>('credentials_sync_to_sidecar');
}

export async function subscribeToCredentialEvents(
  handler: (event: CredentialEvent) => void,
): Promise<() => void> {
  const unlistenStatus = await listen<CredentialStatus>(CREDENTIAL_STATUS_EVENT, (event) => {
    handler({ type: 'status', status: event.payload });
  });
  const unlistenOnboarding = await listen<CredentialOnboardingStatus>(
    CREDENTIAL_ONBOARDING_EVENT,
    (event) => {
      handler({ type: 'onboarding', onboarding: event.payload });
    },
  );

  return () => {
    unlistenStatus();
    unlistenOnboarding();
  };
}
