const ALARM_NAME = 'jobcrawler-badge-check';
const CHECK_INTERVAL_MINUTES = 30;
const API_BASE = 'https://jobcrawler-func.azurewebsites.net/api';
const API_KEY = 'dcec9d9bf19d9ff3f036b6ba658ee28a3d2a82ecad7eb5d8a7962f26e3390722';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const data = await chrome.storage.local.get(['userId']);
  if (!data.userId) return;

  try {
    const res = await fetch(
      `${API_BASE}/jobs?userId=${data.userId}&minRelevance=75&limit=1`,
      { headers: { 'x-api-key': API_KEY } }
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
