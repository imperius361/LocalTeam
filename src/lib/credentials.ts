import { appDataDir, join } from '@tauri-apps/api/path';
import { Stronghold } from '@tauri-apps/plugin-stronghold';

const CLIENT_NAME = 'localteam';
const OPENAI_KEY = 'providers.openai';
const ANTHROPIC_KEY = 'providers.anthropic';

type StoreLike = {
  get(key: string): Promise<Uint8Array | null>;
  insert(key: string, value: number[]): Promise<void>;
  remove(key: string): Promise<Uint8Array | null>;
};

let strongholdInstance: Stronghold | null = null;
let storeInstance: StoreLike | null = null;

async function getVaultPath(): Promise<string> {
  return join(await appDataDir(), 'localteam-vault.hold');
}

async function getStore(password: string): Promise<StoreLike> {
  if (storeInstance) {
    return storeInstance;
  }

  const stronghold = await Stronghold.load(await getVaultPath(), password);
  let client: { getStore(): StoreLike };

  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
  }

  strongholdInstance = stronghold;
  storeInstance = client.getStore();
  return storeInstance;
}

export async function unlockVault(password: string): Promise<void> {
  await getStore(password);
}

export async function lockVault(): Promise<void> {
  if (strongholdInstance) {
    await strongholdInstance.unload();
  }
  strongholdInstance = null;
  storeInstance = null;
}

export async function saveProviderKeys(
  password: string,
  values: Partial<Record<'openai' | 'anthropic', string>>,
): Promise<void> {
  const store = await getStore(password);
  const stronghold = strongholdInstance;

  await writeValue(store, OPENAI_KEY, values.openai);
  await writeValue(store, ANTHROPIC_KEY, values.anthropic);
  await stronghold?.save();
}

export async function readProviderKeys(
  password: string,
): Promise<Partial<Record<'openai' | 'anthropic', string>>> {
  const store = await getStore(password);

  return {
    openai: await readValue(store, OPENAI_KEY),
    anthropic: await readValue(store, ANTHROPIC_KEY),
  };
}

async function writeValue(
  store: StoreLike,
  key: string,
  value: string | undefined,
): Promise<void> {
  const nextValue = value?.trim();
  if (nextValue) {
    await store.insert(key, Array.from(new TextEncoder().encode(nextValue)));
    return;
  }

  const existing = await store.get(key);
  if (existing) {
    await store.remove(key);
  }
}

async function readValue(store: StoreLike, key: string): Promise<string | undefined> {
  const data = await store.get(key);
  if (!data) {
    return undefined;
  }
  return new TextDecoder().decode(data);
}
