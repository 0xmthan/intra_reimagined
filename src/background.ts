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

// ---------- framing intra pages in our windows (clusters.ts: Clusters, Manage slots) ----------
// meta's clusters map, the slots page and achievements pages refuse to be framed by other pages (X-Frame-Options).
// When a tab opens one of our windows it asks here, and that tab alone may frame them. (A static
// rule keyed on the initiator doesn't work: the frame is made by our content script, so Firefox
// sees the extension, not intra, as its initiator.)
interface FrameApi {
  runtime: { onMessage: { addListener(cb: (msg: unknown, sender: { tab?: { id?: number } }) => Promise<unknown> | undefined): void } };
  tabs: { onRemoved: { addListener(cb: (tabId: number) => void): void } };
  declarativeNetRequest: {
    updateSessionRules(o: { removeRuleIds?: number[]; addRules?: unknown[] }): Promise<void>;
  };
}
const frameApi = api as unknown as FrameApi;

function allowFrames(tabId: number) {
  return frameApi.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [
      {
        id: tabId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
          ],
        },
        condition: {
          regexFilter: '^https://(meta\\.intra\\.42\\.fr/clusters|profile\\.intra\\.42\\.fr/(slots|users/[a-z0-9-]+/achievements))',
          resourceTypes: ['sub_frame'],
          tabIds: [tabId],
        },
      },
    ],
  });
}

frameApi.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if ((msg as { type?: string })?.type !== 'ir-allow-frames' || tabId == null || tabId < 1) return undefined;
  return allowFrames(tabId).then(() => true, () => false);
});
frameApi.tabs.onRemoved.addListener((tabId) => {
  if (tabId >= 1) frameApi.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});
});
