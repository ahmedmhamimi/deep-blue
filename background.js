// background.js - MV3 service worker.
//
// Responsibilities:
//   1. On first install: remember that a welcome is pending, then immediately
//      take the person to DeepSeek - reloading every already-open DeepSeek tab
//      (so the freshly installed content scripts attach) and focusing one, or
//      opening a new tab when none exist.
//   2. Always keep the uninstall survey URL registered.
//   3. Count days of use and hand out the VamimiAI announcement once
//      (claimAnnouncement).
//   4. Open VamimiAI in a new tab for features/diagram-handoff.js (only that
//      origin; the reply travels in the URL fragment, never to a server).

'use strict';

const DEEPSEEK_URL = 'https://chat.deepseek.com/';
const DEEPSEEK_MATCH = 'https://chat.deepseek.com/*';
const UNINSTALL_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfSLeAlAR99XVRds06ysehhihgkG3NE4ejHx6cJOTdZr0teNQ/viewform?usp=publish-editor';
const REVIEW_STATE_KEY = 'deepblue-review-state-v1';
const WELCOME_KEY = 'deepblue-welcome-pending-v1';
// The one-time VamimiAI announcement (src/whats-new.js):
//   { status: 'waiting' | 'shown', minDays, days: ['YYYY-MM-DD', ...] }
// It is claimed (and shown) once DeepSeek has been opened on `minDays`
// distinct days. People updating from before ANNOUNCE_SINCE are established
// users and see it on their next visit (minDays 0); a fresh install waits
// for NEW_USER_DAYS days of use, so a new user's first days belong to the
// welcome splash and DeepBlue itself. The Diagram button's spotlight is
// armed by the announcement when it shows, never before.
const ANNOUNCE_KEY = 'deepblue-announce-v1';
const ANNOUNCE_SINCE = '1.6';
const NEW_USER_DAYS = 3;
// Keep in step with CONFIG.diagram.appUrl in src/config.js.
const DIAGRAM_ORIGIN = 'https://www.vamimi.com';

// true if dotted version a is older than b (missing parts count as 0)
function isOlder(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function registerUninstallUrl() {
  try {
    chrome.runtime.setUninstallURL(UNINSTALL_URL);
  } catch (err) {
    console.debug('DeepBlue: setUninstallURL failed', err);
  }
}

// Re-registered on every service-worker start as well as on install, so it
// survives profile syncs, browser updates and extension reloads.
registerUninstallUrl();

async function goToDeepSeek() {
  const tabs = await chrome.tabs.query({ url: DEEPSEEK_MATCH });

  if (!tabs.length) {
    await chrome.tabs.create({ url: DEEPSEEK_URL, active: true });
    return;
  }

  // Prefer the tab the person was most likely looking at.
  const target =
    tabs.find((t) => t.active && t.highlighted) ||
    tabs.find((t) => t.active) ||
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id).catch(() => {})));

  try {
    await chrome.windows.update(target.windowId, { focused: true });
    await chrome.tabs.update(target.id, { active: true });
  } catch (err) {
    console.debug('DeepBlue: could not focus DeepSeek tab', err);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  registerUninstallUrl();

  if (details.reason === 'install') {
    // Flags are written BEFORE any tab is touched so the content script can
    // never load, look for them, and find nothing.
    await chrome.storage.local.set({
      [WELCOME_KEY]: true,
      [REVIEW_STATE_KEY]: {
        installedAt: Date.now(),
        score: 0,
        activeDays: [],
        asks: 0,
        status: 'pending',
        nextEligibleAt: 0,
      },
      [ANNOUNCE_KEY]: { status: 'waiting', minDays: NEW_USER_DAYS, days: [] },
    });
    await goToDeepSeek();
  } else if (
    details.reason === 'update' &&
    details.previousVersion &&
    isOlder(details.previousVersion, ANNOUNCE_SINCE)
  ) {
    const res = await chrome.storage.local.get(ANNOUNCE_KEY);
    if (!res[ANNOUNCE_KEY]) {
      await chrome.storage.local.set({ [ANNOUNCE_KEY]: { status: 'waiting', minDays: 0, days: [] } });
    }
  }
});

// Several DeepSeek tabs can be reloaded at once on install, and each one's
// content script will ask to show the welcome splash. Requests are processed
// strictly one at a time, and the first one wins and clears the flag.
let claimQueue = Promise.resolve();

// message type -> the storage flag it claims
const CLAIMS = {
  'deepblue:claim-welcome': WELCOME_KEY,
};

// Local calendar day, so "3 days of use" means 3 dates on the person's clock.
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Each DeepSeek page load asks once: today counts as a day of use, and the
// announcement is handed to the first page that asks once enough days have
// passed. Runs in claimQueue, so two tabs can never both get it.
async function claimAnnouncement() {
  const res = await chrome.storage.local.get(ANNOUNCE_KEY);
  const state = res[ANNOUNCE_KEY];
  if (!state || state.status !== 'waiting') return { claimed: false };
  const today = dayKey();
  const days = Array.isArray(state.days) ? state.days : [];
  if (!days.includes(today)) days.push(today);
  state.days = days.slice(-30);
  const claimed = state.days.length >= (state.minDays || 0);
  if (claimed) state.status = 'shown';
  await chrome.storage.local.set({ [ANNOUNCE_KEY]: state });
  return { claimed };
}

// A new tab right after the DeepSeek tab the button was clicked in.
function openDiagram(msg, sender, sendResponse) {
  let url;
  try {
    url = new URL(msg.url);
  } catch (err) {
    sendResponse({ ok: false });
    return false;
  }
  if (url.origin !== DIAGRAM_ORIGIN) {
    sendResponse({ ok: false });
    return false;
  }
  const tab = sender?.tab;
  chrome.tabs
    .create({
      url: url.toString(),
      active: true,
      ...(tab ? { index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId } : {}),
    })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => {
      console.debug('DeepBlue: could not open VamimiAI', err);
      sendResponse({ ok: false });
    });
  return true; // async response
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'deepblue:open-diagram') return openDiagram(msg, _sender, sendResponse);
  if (msg?.type === 'deepblue:claim-whatsnew') {
    claimQueue = claimQueue.then(claimAnnouncement);
    claimQueue.then(sendResponse).catch(() => sendResponse({ claimed: false }));
    return true; // async response
  }
  const key = CLAIMS[msg?.type];
  if (!key) return false;

  claimQueue = claimQueue.then(async () => {
    const res = await chrome.storage.local.get(key);
    if (res[key] === true) {
      await chrome.storage.local.set({ [key]: false });
      return { claimed: true };
    }
    return { claimed: false };
  });

  claimQueue.then(sendResponse).catch(() => sendResponse({ claimed: false }));
  return true; // async response
});
