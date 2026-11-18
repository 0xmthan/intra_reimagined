// Extension settings, stored in the extension's own storage so they apply on every intra
// subdomain (page localStorage is per-origin). Works with Firefox's `browser` and Chrome's `chrome`.

export interface Settings {
  darkMode: boolean;
  newHeader: boolean;
  sidebarTools: boolean;
}

const DEFAULTS: Settings = { darkMode: false, newHeader: true, sidebarTools: true };
const KEY = 'settings';

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
interface ExtApi {
  storage: {
    local: StorageArea;
    onChanged: { addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
  };
}

const ext = (globalThis as unknown as { browser?: ExtApi; chrome?: ExtApi }).browser ??
  (globalThis as unknown as { chrome?: ExtApi }).chrome;

export async function getSettings(): Promise<Settings> {
  try {
    const stored = (await ext?.storage.local.get(KEY))?.[KEY] as Partial<Settings> | undefined;
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const next = { ...(await getSettings()), [key]: value };
  await ext?.storage.local.set({ [KEY]: next });
}

/** Fires in every open intra tab when a setting changes, so toggles apply live. */
export function onSettingsChange(cb: (s: Settings) => void) {
  ext?.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) cb({ ...DEFAULTS, ...(changes[KEY].newValue as Partial<Settings>) });
  });
}
