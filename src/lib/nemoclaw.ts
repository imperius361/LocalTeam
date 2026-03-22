import { invoke } from '@tauri-apps/api/core';
import type { RuntimeProfileSummary } from './contracts';

export interface NemoclawRuntimeStatus {
  onboardingCompleted: boolean;
  profiles: RuntimeProfileSummary[];
  lastError?: string;
}

export async function getNemoclawRuntimeStatus(): Promise<NemoclawRuntimeStatus> {
  return invoke<NemoclawRuntimeStatus>('nemoclaw_get_status');
}

export async function launchNemoclawOnboarding(): Promise<NemoclawRuntimeStatus> {
  return invoke<NemoclawRuntimeStatus>('nemoclaw_launch_onboarding');
}
