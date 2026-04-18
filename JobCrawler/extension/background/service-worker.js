const ALARM_NAME = 'jobcrawler-badge-check';
const CHECK_INTERVAL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const data = await chrome.storage.local.get(['userId', 'lastPopupOpenedAt']);
  if (!data.userId) return;

  try {
    const since = data.lastPopupOpenedAt || new Date(0).toISOString();
    const res = await fetch(
      `http://localhost:3000/api/jobs?userId=${data.userId}&minRelevance=75&limit=1`
    );
    if (!res.ok) return;

    const result = await res.json();
    const count = result.pagination?.total || 0;

    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count > 99 ? '99+' : count) });
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Silently fail — backend might be offline
  }
});

// Clear badge when popup opens
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'popup-opened') {
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.local.set({ lastPopupOpenedAt: new Date().toISOString() });
  }
});
