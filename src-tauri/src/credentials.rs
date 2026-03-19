use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Default)]
struct KeyStore {
    keys: HashMap<String, String>,
}

pub struct CredentialState {
    store_path: PathBuf,
    encryption_key: [u8; 32],
    cache: Mutex<KeyStore>,
}

impl CredentialState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let store_path = app_data_dir.join("credentials.enc");
        // Derive a machine-bound key. Not a substitute for user passwords
        // in high-security contexts, but prevents casual file reading.
        let key_material = format!("localteam-{}", whoami::username());
        let mut encryption_key = [0u8; 32];
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        key_material.hash(&mut hasher);
        let hash = hasher.finish();
        encryption_key[..8].copy_from_slice(&hash.to_le_bytes());
        key_material.len().hash(&mut hasher);
        let hash2 = hasher.finish();
        encryption_key[8..16].copy_from_slice(&hash2.to_le_bytes());
        store_path.to_str().unwrap_or("").hash(&mut hasher);
        let hash3 = hasher.finish();
        encryption_key[16..24].copy_from_slice(&hash3.to_le_bytes());
        "localteam-salt-v1".hash(&mut hasher);
        let hash4 = hasher.finish();
        encryption_key[24..32].copy_from_slice(&hash4.to_le_bytes());

        let cache = if store_path.exists() {
            Self::load_store_static(&store_path, &encryption_key).unwrap_or_default()
        } else {
            KeyStore::default()
        };

        Self {
            store_path,
            encryption_key,
            cache: Mutex::new(cache),
        }
    }

    fn load_store_static(path: &PathBuf, key: &[u8; 32]) -> Result<KeyStore, String> {
        let data = fs::read(path).map_err(|e| format!("Failed to read store: {e}"))?;
        if data.len() < 12 {
            return Err("Corrupt store file".into());
        }
        let (nonce_bytes, ciphertext) = data.split_at(12);
        let cipher =
            Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {e}"))?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| "Failed to decrypt credentials".to_string())?;
        serde_json::from_slice(&plaintext).map_err(|e| format!("Failed to parse store: {e}"))
    }

    fn save_store(&self) -> Result<(), String> {
        let cache = self.cache.lock().unwrap();
        let plaintext =
            serde_json::to_vec(&*cache).map_err(|e| format!("Failed to serialize store: {e}"))?;

        let cipher = Aes256Gcm::new_from_slice(&self.encryption_key)
            .map_err(|e| format!("Failed to create cipher: {e}"))?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|e| format!("Failed to encrypt: {e}"))?;

        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
        }

        let mut output = nonce_bytes.to_vec();
        output.extend(ciphertext);
        fs::write(&self.store_path, output).map_err(|e| format!("Failed to write store: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn store_api_key(
    state: tauri::State<'_, CredentialState>,
    provider: String,
    key: String,
) -> Result<(), String> {
    {
        let mut cache = state.cache.lock().unwrap();
        cache.keys.insert(provider, key);
    }
    state.save_store()
}

#[tauri::command]
pub fn get_api_key(
    state: tauri::State<'_, CredentialState>,
    provider: String,
) -> Result<Option<String>, String> {
    let cache = state.cache.lock().unwrap();
    Ok(cache.keys.get(&provider).cloned())
}

#[tauri::command]
pub fn delete_api_key(
    state: tauri::State<'_, CredentialState>,
    provider: String,
) -> Result<(), String> {
    {
        let mut cache = state.cache.lock().unwrap();
        cache.keys.remove(&provider);
    }
    state.save_store()
}

#[tauri::command]
pub fn list_providers(
    state: tauri::State<'_, CredentialState>,
) -> Result<Vec<String>, String> {
    let cache = state.cache.lock().unwrap();
    Ok(cache.keys.keys().cloned().collect())
}
