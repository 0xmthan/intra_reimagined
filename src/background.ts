// Background (event page): get new versions to users fast. Firefox looks for add-on updates
// about once a day; we also ask at startup and every hour, and apply an update as soon as
// Firefox has downloaded it instead of waiting for the next browser restart.
interface UpdateApi {
  runtime: {
    requestUpdateCheck(): Promise<unknown>;
    reload(): void;
    onStartup: { addListener(cb: () => void): void };
    onInstalled: { addListener(cb: () => void): void };
    onUpdateAvailable: { addListener(cb: () => void): void };
  };
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  alarms: {
    create(name: string, info: { delayInMinutes?: number; periodInMinutes: number }): void;
    onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
  };
}

const api = ((globalThis as { browser?: UpdateApi }).browser ?? (globalThis as { chrome?: UpdateApi }).chrome)!;
const ALARM = 'ir-update-check';

const check = () => {
  // Rejects when the add-on has no update source (e.g. a temporary dev install): nothing to do.
  api.runtime.requestUpdateCheck().catch(() => {});
};

const schedule = () => api.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 60 });

// A new id per browser start: popups dismissed with "Skip" / "Continue" come back after a restart (gate.ts).
const newSession = () => api.storage.local.set({ browserSession: crypto.randomUUID() }).catch(() => {});

api.runtime.onStartup.addListener(() => {
  newSession();
  schedule();
  check();
});
api.runtime.onInstalled.addListener(() => {
  newSession();
  schedule();
});
api.alarms.onAlarm.addListener((alarm) => alarm.name === ALARM && check());

// A new version is downloaded: switch to it now. Open intra tabs pick it up on their next load.
api.runtime.onUpdateAvailable.addListener(() => api.runtime.reload());
