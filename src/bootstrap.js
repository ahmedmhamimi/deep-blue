// bootstrap.js - single MutationObserver that drives the whole extension.
//
// This is the last file listed in manifest.json's content_scripts[].js array:
// by the time it runs, every module above (config, dom, features/*, pdf/*)
// has already been declared. It re-scans the page on every relevant DOM
// change and re-injects/re-syncs whichever pieces of DeepBlue UI are missing,
// while guarding against reacting to DeepBlue's own writes (isOwnMutation).
//
// Depends on: config.js, utils.js (debounce), dom.js, bridge-client.js, and every
// feature module (Toolbar, TokenCounter, ContextMeter, ChatSearch,
// SidebarSearch, Folders, CopyPlain, MessagePdfExport, Bookmarks, QuickActions).

'use strict';

// True if every mutation in this batch originated from DeepBlue's own
// writes to the page, rather than DeepSeek re-rendering something. Uses
// the single shared isInsideDeepBlueUI check (utils.js) instead of a
// hand-maintained per-feature id/class list, so a new feature's injected
// elements are automatically excluded here as soon as they follow the
// 'deepblue-' naming convention every other feature already uses.
function isOwnMutation(mutations) {
  return mutations.every((m) => isInsideDeepBlueUI(m.target));
}

function runScan() {
  Toolbar.ensureInjected();
  TokenCounter.scan();
  ContextMeter.scan();
  ChatSearch.ensureInjected();
  ChatSearch._injectStyles();
  SidebarSearch.ensureInjected();
  SidebarSearch._reapplyIfActive();
  Folders.ensureInjected();
  ToneSelector.ensureInjected();
  CopyPlain.scan();
  MessagePdfExport.scan();
  Bookmarks.scan();
  QuickActions.scan();
}

const debouncedScan = debounce(runScan, CONFIG.timing.observerDebounceMs);

const observer = new MutationObserver((mutations) => {
  if (isOwnMutation(mutations)) return;
  debouncedScan();
});

function start() {
  Bridge.listen();
  Bridge.inject();
  setTimeout(runScan, CONFIG.timing.initialScanDelayMs);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'complete') {
  start();
} else {
  window.addEventListener('load', start, { once: true });
}

console.log(`${BRAND_NAME} Export PDF extension loaded!`);
