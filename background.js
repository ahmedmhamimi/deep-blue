// background.js - MV3 service worker.
//
// Responsibilities:
//   1. On first install: remember that a welcome is pending, then immediately
//      take the person to DeepSeek - reloading every already-open DeepSeek tab
//      (so the freshly installed content scripts attach) and focusing one, or
//      opening a new tab when none exist.
//   2. Always keep the uninstall survey URL registered.

'use strict';

const DEEPSEEK_URL = 'https://chat.deepseek.com/';
const DEEPSEEK_MATCH = 'https://chat.deepseek.com/*';
const UNINSTALL_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfSLeAlAR99XVRds06ysehhihgkG3NE4ejHx6cJOTdZr0teNQ/viewform?usp=publish-editor';
const REVIEW_STATE_KEY = 'deepblue-review-state-v1';
const WELCOME_KEY = 'deepblue-welcome-pending-v1';

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
    });
    await goToDeepSeek();
  }
});

// Several DeepSeek tabs can be reloaded at once on install, and each one's
// content script will ask to show the welcome splash. Requests are processed
// strictly one at a time, and the first one wins and clears the flag.
let claimQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'deepblue:claim-welcome') return false;

  claimQueue = claimQueue.then(async () => {
    const res = await chrome.storage.local.get(WELCOME_KEY);
    if (res[WELCOME_KEY] === true) {
      await chrome.storage.local.set({ [WELCOME_KEY]: false });
      return { claimed: true };
    }
    return { claimed: false };
  });

  claimQueue.then(sendResponse).catch(() => sendResponse({ claimed: false }));
  return true; // async response
});
