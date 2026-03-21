use crate::sidecar;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read_to_string, write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_stronghold::stronghold::Stronghold;

const CLIENT_NAME: &[u8] = b"localteam";
const OPENAI_KEY: &str = "providers.openai";
const ANTHROPIC_KEY: &str = "providers.anthropic";
const VAULT_FILE: &str = "localteam-vault.hold";
const VAULT_AUTH_MARKER_KEY: &str = "vault.meta.initialized";
const CREDENTIAL_STATUS_FILE: &str = "credential-status.json";
const CREDENTIAL_ONBOARDING_FILE: &str = "credential-onboarding.json";
const CREDENTIAL_STATUS_CHANGED_EVENT: &str = "localteam://credential-status-changed";
const CREDENTIAL_ONBOARDING_CHANGED_EVENT: &str = "localteam://credential-onboarding-changed";

static SYNC_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct CredentialState {
    session: Mutex<Option<CredentialSession>>,
}

impl CredentialState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

struct CredentialSession {
    stronghold: Stronghold,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Openai,
    Anthropic,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialStatus {
    pub provider: ProviderId,
    pub has_key: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub unlocked: bool,
    pub vault_exists: bool,
    pub providers: Vec<ProviderCredentialStatus>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialOnboardingStatus {
    pub api_key_prompt_dismissed: bool,
    pub has_saved_keys: bool,
    pub should_prompt_for_api_keys: bool,
}

#[derive(Clone, Default, Serialize)]
pub struct ProviderKeys {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
struct StoredCredentialPresence {
    openai: bool,
    anthropic: bool,
}

#[derive(Default, Deserialize, Serialize)]
struct StoredCredentialOnboarding {
    api_key_prompt_dismissed: bool,
}

struct CredentialPaths {
    vault_path: PathBuf,
    salt_path: PathBuf,
    status_path: PathBuf,
    onboarding_path: PathBuf,
}

fn lock_session<'a>(
    state: &'a CredentialState,
) -> Result<MutexGuard<'a, Option<CredentialSession>>, String> {
    state
        .session
        .lock()
        .map_err(|_| "Credential state lock poisoned".to_string())
}

fn get_or_create_client(stronghold: &Stronghold) -> Result<iota_stronghold::Client, String> {
    if let Ok(client) = stronghold.get_client(CLIENT_NAME) {
        return Ok(client);
    }

    if let Ok(client) = stronghold.load_client(CLIENT_NAME) {
        return Ok(client);
    }

    stronghold
        .create_client(CLIENT_NAME)
        .map_err(|error| format!("Failed to access vault client: {error}"))
}

fn provider_key(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::Openai => OPENAI_KEY,
        ProviderId::Anthropic => ANTHROPIC_KEY,
    }
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn credential_paths(app: &AppHandle) -> Result<CredentialPaths, String> {
    let data_dir = app_data_dir(app)?;
    create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to prepare credential directory: {error}"))?;

    Ok(CredentialPaths {
        vault_path: data_dir.join(VAULT_FILE),
        salt_path: data_dir.join("salt.txt"),
        status_path: data_dir.join(CREDENTIAL_STATUS_FILE),
        onboarding_path: data_dir.join(CREDENTIAL_ONBOARDING_FILE),
    })
}

fn unlock_existing_session(app: &AppHandle, password: String) -> Result<CredentialSession, String> {
    if password.trim().is_empty() {
        return Err("Vault password is required".to_string());
    }

    let paths = credential_paths(app)?;
    if !paths.vault_path.exists() {
        return Err("Credential vault has not been created yet".to_string());
    }

    let mut password = password;
    let hash = tauri_plugin_stronghold::kdf::KeyDerivation::argon2(&password, &paths.salt_path);
    password.clear();

    let stronghold = Stronghold::new(&paths.vault_path, hash)
        .map_err(|error| format!("Failed to unlock credential vault: {error}"))?;

    let session = CredentialSession { stronghold };
    ensure_vault_auth_marker(&session)?;
    Ok(session)
}

fn create_vault_session(app: &AppHandle, password: String) -> Result<CredentialSession, String> {
    if password.trim().is_empty() {
        return Err("Vault password is required".to_string());
    }

    let paths = credential_paths(app)?;
    if paths.vault_path.exists() {
        return Err("Credential vault already exists".to_string());
    }

    let mut password = password;
    let hash = tauri_plugin_stronghold::kdf::KeyDerivation::argon2(&password, &paths.salt_path);
    password.clear();

    let stronghold = Stronghold::new(&paths.vault_path, hash)
        .map_err(|error| format!("Failed to create credential vault: {error}"))?;

    let session = CredentialSession { stronghold };
    ensure_vault_auth_marker(&session)?;
    Ok(session)
}

fn read_store_value(store: &iota_stronghold::Store, key: &str) -> Result<Option<String>, String> {
    let maybe_value = store
        .get(key.as_bytes())
        .map_err(|error| format!("Failed to read credential value: {error}"))?;

    match maybe_value {
        Some(value) => String::from_utf8(value)
            .map(Some)
            .map_err(|_| "Stored credential is not valid UTF-8".to_string()),
        None => Ok(None),
    }
}

fn read_provider_keys_from_session(session: &CredentialSession) -> Result<ProviderKeys, String> {
    let client = get_or_create_client(&session.stronghold)?;
    let store = client.store();

    Ok(ProviderKeys {
        openai: read_store_value(&store, OPENAI_KEY)?,
        anthropic: read_store_value(&store, ANTHROPIC_KEY)?,
    })
}

fn write_provider_value(
    session: &CredentialSession,
    provider: ProviderId,
    value: Option<String>,
) -> Result<(), String> {
    let client = get_or_create_client(&session.stronghold)?;
    let store = client.store();
    let key = provider_key(provider);

    if let Some(value) = value {
        let value = value.trim().to_string();
        if value.is_empty() {
            let _ = store
                .delete(key.as_bytes())
                .map_err(|error| format!("Failed to clear credential: {error}"))?;
        } else {
            let _ = store
                .insert(key.as_bytes().to_vec(), value.into_bytes(), None)
                .map_err(|error| format!("Failed to persist credential: {error}"))?;
        }
    } else {
        let _ = store
            .delete(key.as_bytes())
            .map_err(|error| format!("Failed to clear credential: {error}"))?;
    }

    session
        .stronghold
        .save()
        .map_err(|error| format!("Failed to save credential vault: {error}"))
}

fn has_any_keys(keys: &ProviderKeys) -> bool {
    keys.openai
        .as_ref()
        .is_some_and(|value| !value.is_empty())
        || keys
            .anthropic
            .as_ref()
            .is_some_and(|value| !value.is_empty())
}

fn status_from_keys(unlocked: bool, vault_exists: bool, keys: &ProviderKeys) -> CredentialStatus {
    CredentialStatus {
        unlocked,
        vault_exists,
        providers: vec![
            ProviderCredentialStatus {
                provider: ProviderId::Openai,
                has_key: keys.openai.as_ref().is_some_and(|value| !value.is_empty()),
            },
            ProviderCredentialStatus {
                provider: ProviderId::Anthropic,
                has_key: keys
                    .anthropic
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
            },
        ],
    }
}

fn onboarding_status_from_state(
    dismissed: bool,
    has_saved_keys: bool,
) -> CredentialOnboardingStatus {
    CredentialOnboardingStatus {
        api_key_prompt_dismissed: dismissed,
        has_saved_keys,
        should_prompt_for_api_keys: !dismissed && !has_saved_keys,
    }
}

fn keys_to_presence(keys: &ProviderKeys) -> StoredCredentialPresence {
    StoredCredentialPresence {
        openai: keys.openai.as_ref().is_some_and(|value| !value.is_empty()),
        anthropic: keys.anthropic.as_ref().is_some_and(|value| !value.is_empty()),
    }
}

fn status_from_presence(
    unlocked: bool,
    vault_exists: bool,
    presence: &StoredCredentialPresence,
) -> CredentialStatus {
    CredentialStatus {
        unlocked,
        vault_exists,
        providers: vec![
            ProviderCredentialStatus {
                provider: ProviderId::Openai,
                has_key: presence.openai,
            },
            ProviderCredentialStatus {
                provider: ProviderId::Anthropic,
                has_key: presence.anthropic,
            },
        ],
    }
}

fn read_stored_presence(path: &Path) -> Result<StoredCredentialPresence, String> {
    match read_to_string(path) {
        Ok(raw) => serde_json::from_str::<StoredCredentialPresence>(&raw)
            .map_err(|error| format!("Failed to parse credential status: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(StoredCredentialPresence::default())
        }
        Err(error) => Err(format!("Failed to read credential status: {error}")),
    }
}

fn write_stored_presence(path: &Path, keys: &ProviderKeys) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare credential status directory: {error}"))?;
    }

    let payload = serde_json::to_vec_pretty(&keys_to_presence(keys))
        .map_err(|error| format!("Failed to serialize credential status: {error}"))?;
    write(path, payload).map_err(|error| format!("Failed to write credential status: {error}"))
}

fn read_stored_onboarding(path: &Path) -> Result<StoredCredentialOnboarding, String> {
    match read_to_string(path) {
        Ok(raw) => serde_json::from_str::<StoredCredentialOnboarding>(&raw)
            .map_err(|error| format!("Failed to parse credential onboarding state: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(StoredCredentialOnboarding::default())
        }
        Err(error) => Err(format!("Failed to read credential onboarding state: {error}")),
    }
}

fn write_stored_onboarding(path: &Path, dismissed: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|error| {
            format!("Failed to prepare credential onboarding directory: {error}")
        })?;
    }

    let payload = serde_json::to_vec_pretty(&StoredCredentialOnboarding {
        api_key_prompt_dismissed: dismissed,
    })
    .map_err(|error| format!("Failed to serialize credential onboarding state: {error}"))?;
    write(path, payload).map_err(|error| format!("Failed to write credential onboarding state: {error}"))
}

fn ensure_vault_auth_marker(session: &CredentialSession) -> Result<(), String> {
    let client = get_or_create_client(&session.stronghold)?;
    let store = client.store();
    let marker = store
        .get(VAULT_AUTH_MARKER_KEY.as_bytes())
        .map_err(|error| format!("Failed to read credential vault marker: {error}"))?;

    if marker.is_none() {
        let _ = store
            .insert(
                VAULT_AUTH_MARKER_KEY.as_bytes().to_vec(),
                b"initialized".to_vec(),
                None,
            )
            .map_err(|error| format!("Failed to initialize credential vault: {error}"))?;
        session
            .stronghold
            .save()
            .map_err(|error| format!("Failed to save credential vault: {error}"))?;
    }

    Ok(())
}

fn current_vault_exists(app: &AppHandle) -> Result<bool, String> {
    Ok(credential_paths(app)?.vault_path.exists())
}

fn maybe_dismiss_onboarding_if_keys_exist(app: &AppHandle, keys: &ProviderKeys) -> Result<(), String> {
    if has_any_keys(keys) {
        let paths = credential_paths(app)?;
        write_stored_onboarding(&paths.onboarding_path, true)?;
    }

    Ok(())
}

fn load_onboarding_status(app: &AppHandle, has_saved_keys: bool) -> Result<CredentialOnboardingStatus, String> {
    let paths = credential_paths(app)?;
    let onboarding = read_stored_onboarding(&paths.onboarding_path)?;
    Ok(onboarding_status_from_state(
        onboarding.api_key_prompt_dismissed,
        has_saved_keys,
    ))
}

fn write_vault_status(app: &AppHandle, keys: &ProviderKeys) -> Result<(), String> {
    let paths = credential_paths(app)?;
    write_stored_presence(&paths.status_path, keys)?;
    maybe_dismiss_onboarding_if_keys_exist(app, keys)
}

fn next_sync_request_id() -> String {
    format!(
        "credentials-sync-{}",
        SYNC_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn emit_credential_status(app: &AppHandle, status: &CredentialStatus) {
    let _ = app.emit(CREDENTIAL_STATUS_CHANGED_EVENT, status);
}

fn emit_onboarding_status(app: &AppHandle, status: &CredentialOnboardingStatus) {
    let _ = app.emit(CREDENTIAL_ONBOARDING_CHANGED_EVENT, status);
}

fn sync_keys_to_sidecar(app: &AppHandle, keys: &ProviderKeys) -> Result<(), String> {
    let message = serde_json::json!({
      "id": next_sync_request_id(),
      "method": "v1.credentials.sync",
      "params": {
        "values": {
          "openai": keys.openai.clone().unwrap_or_default(),
          "anthropic": keys.anthropic.clone().unwrap_or_default(),
        }
      }
    })
    .to_string();

    sidecar::write_to_sidecar(app, &message)
}

pub fn sync_loaded_credentials_to_sidecar(
    app: &AppHandle,
    state: &CredentialState,
) -> Result<CredentialStatus, String> {
    let (unlocked, keys) = {
        let session_guard = lock_session(state)?;
        if let Some(session) = session_guard.as_ref() {
            (true, read_provider_keys_from_session(session)?)
        } else {
            (false, ProviderKeys::default())
        }
    };

    sync_keys_to_sidecar(app, &keys)?;

    if unlocked {
        write_vault_status(app, &keys)?;
        let status = status_from_keys(true, current_vault_exists(app)?, &keys);
        emit_credential_status(app, &status);
        Ok(status)
    } else {
        let paths = credential_paths(app)?;
        let presence = read_stored_presence(&paths.status_path).unwrap_or_default();
        let status = status_from_presence(false, current_vault_exists(app)?, &presence);
        emit_credential_status(app, &status);
        Ok(status)
    }
}

#[tauri::command]
pub async fn credentials_create_vault(
    app: AppHandle,
    state: State<'_, CredentialState>,
    password: String,
) -> Result<CredentialStatus, String> {
    let keys = {
        let mut session_guard = lock_session(state.inner())?;
        let session = create_vault_session(&app, password)?;
        *session_guard = Some(session);
        let session = session_guard
            .as_ref()
            .ok_or_else(|| "Credential vault could not be created".to_string())?;
        read_provider_keys_from_session(session)?
    };

    let paths = credential_paths(&app)?;
    write_vault_status(&app, &keys)?;
    sync_keys_to_sidecar(&app, &keys)?;
    let status = status_from_keys(true, paths.vault_path.exists(), &keys);
    emit_credential_status(&app, &status);
    let onboarding = load_onboarding_status(&app, has_any_keys(&keys))?;
    emit_onboarding_status(&app, &onboarding);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_unlock_vault(
    app: AppHandle,
    state: State<'_, CredentialState>,
    password: String,
) -> Result<CredentialStatus, String> {
    let keys = {
        let mut session_guard = lock_session(state.inner())?;
        let session = unlock_existing_session(&app, password)?;
        *session_guard = Some(session);

        let session = session_guard
            .as_ref()
            .ok_or_else(|| "Credential vault is locked".to_string())?;
        read_provider_keys_from_session(session)?
    };

    write_vault_status(&app, &keys)?;
    sync_keys_to_sidecar(&app, &keys)?;
    let status = status_from_keys(true, current_vault_exists(&app)?, &keys);
    emit_credential_status(&app, &status);
    let onboarding = load_onboarding_status(&app, has_any_keys(&keys))?;
    emit_onboarding_status(&app, &onboarding);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_lock_vault(
    app: AppHandle,
    state: State<'_, CredentialState>,
) -> Result<CredentialStatus, String> {
    {
        let mut session_guard = lock_session(state.inner())?;
        *session_guard = None;
    }

    // Best effort: clear sidecar credential cache when locking.
    let _ = sync_keys_to_sidecar(&app, &ProviderKeys::default());

    let paths = credential_paths(&app)?;
    let presence = read_stored_presence(&paths.status_path).unwrap_or_default();
    let status = status_from_presence(false, paths.vault_path.exists(), &presence);
    emit_credential_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_set_provider_key(
    app: AppHandle,
    state: State<'_, CredentialState>,
    provider: ProviderId,
    value: String,
) -> Result<CredentialStatus, String> {
    let keys = {
        let session_guard = lock_session(state.inner())?;
        let session = session_guard
            .as_ref()
            .ok_or_else(|| "Credential vault is locked".to_string())?;

        write_provider_value(session, provider, Some(value))?;
        read_provider_keys_from_session(session)?
    };

    write_vault_status(&app, &keys)?;
    sync_keys_to_sidecar(&app, &keys)?;
    let status = status_from_keys(true, current_vault_exists(&app)?, &keys);
    emit_credential_status(&app, &status);
    let onboarding = load_onboarding_status(&app, has_any_keys(&keys))?;
    emit_onboarding_status(&app, &onboarding);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_clear_provider_key(
    app: AppHandle,
    state: State<'_, CredentialState>,
    provider: ProviderId,
) -> Result<CredentialStatus, String> {
    let keys = {
        let session_guard = lock_session(state.inner())?;
        let session = session_guard
            .as_ref()
            .ok_or_else(|| "Credential vault is locked".to_string())?;

        write_provider_value(session, provider, None)?;
        read_provider_keys_from_session(session)?
    };

    write_vault_status(&app, &keys)?;
    sync_keys_to_sidecar(&app, &keys)?;
    let status = status_from_keys(true, current_vault_exists(&app)?, &keys);
    emit_credential_status(&app, &status);
    let onboarding = load_onboarding_status(&app, has_any_keys(&keys))?;
    emit_onboarding_status(&app, &onboarding);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_get_status(
    app: AppHandle,
    state: State<'_, CredentialState>,
) -> Result<CredentialStatus, String> {
    {
        let session_guard = lock_session(state.inner())?;
        if let Some(session) = session_guard.as_ref() {
            ensure_vault_auth_marker(session)?;
            let keys = read_provider_keys_from_session(session)?;
            drop(session_guard);
            write_vault_status(&app, &keys)?;
            let status = status_from_keys(true, current_vault_exists(&app)?, &keys);
            emit_credential_status(&app, &status);
            return Ok(status);
        }
    }

    let paths = credential_paths(&app)?;
    let presence = read_stored_presence(&paths.status_path)?;
    let status = status_from_presence(false, paths.vault_path.exists(), &presence);
    emit_credential_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_sync_to_sidecar(
    app: AppHandle,
    state: State<'_, CredentialState>,
) -> Result<CredentialStatus, String> {
    sync_loaded_credentials_to_sidecar(&app, state.inner())
}

#[tauri::command]
pub async fn credentials_get_onboarding_state(
    app: AppHandle,
    state: State<'_, CredentialState>,
) -> Result<CredentialOnboardingStatus, String> {
    let has_saved_keys = {
        let session_guard = lock_session(state.inner())?;
        if let Some(session) = session_guard.as_ref() {
            has_any_keys(&read_provider_keys_from_session(session)?)
        } else {
            let paths = credential_paths(&app)?;
            let presence = read_stored_presence(&paths.status_path)?;
            presence.openai || presence.anthropic
        }
    };

    let status = load_onboarding_status(&app, has_saved_keys)?;
    emit_onboarding_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn credentials_dismiss_api_key_prompt(
    app: AppHandle,
) -> Result<CredentialOnboardingStatus, String> {
    let paths = credential_paths(&app)?;
    write_stored_onboarding(&paths.onboarding_path, true)?;
    let has_saved_keys = {
        let presence = read_stored_presence(&paths.status_path)?;
        presence.openai || presence.anthropic
    };
    let status = onboarding_status_from_state(true, has_saved_keys);
    emit_onboarding_status(&app, &status);
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_from_keys_reports_vault_existence() {
        let status = status_from_keys(
            true,
            true,
            &ProviderKeys {
                openai: Some("sk-openai".to_string()),
                anthropic: None,
            },
        );

        assert!(status.unlocked);
        assert!(status.vault_exists);
        assert!(status.providers.iter().any(|provider| provider.has_key));
    }

    #[test]
    fn onboarding_prompt_is_only_required_when_keys_are_missing_and_not_dismissed() {
        let prompt = onboarding_status_from_state(false, false);
        assert!(prompt.should_prompt_for_api_keys);

        let dismissed = onboarding_status_from_state(true, false);
        assert!(!dismissed.should_prompt_for_api_keys);

        let keys_saved = onboarding_status_from_state(false, true);
        assert!(!keys_saved.should_prompt_for_api_keys);
    }
}
