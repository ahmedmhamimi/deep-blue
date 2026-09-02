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
// SidebarSearch, Folders, PromptLibrary, CopyPlain, MessagePdfExport,
// Bookmarks, QuickActions).

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
  Theme.sync();
  Toolbar.ensureInjected();

  // Every message-scanning feature below used to run its own independent
  // document.querySelectorAll() over the whole message list on every
  // single scan tick - up to 5 redundant full-DOM queries per tick, all
  // returning the exact same set of nodes. Query once here and hand the
  // same live NodeList to each of them instead.
  const messages = DOM.findMessages();
  TokenCounter.scan(messages);
  ContextMeter.scan(messages);

  ChatSearch.ensureInjected();
  ChatSearch._injectStyles();

  // Same redundancy, same fix, for the sidebar's conversation-link list:
  // Folders, QuickActions, and (when its search box has an active query)
  // SidebarSearch each used to re-query it independently every tick.
  const sidebarLinks = DOM.getSidebarConversationLinks();
  SidebarSearch.ensureInjected();
  SidebarSearch._reapplyIfActive(sidebarLinks);
  Folders.ensureInjected(sidebarLinks);
  ToneSelector.ensureInjected();
  PromptLibrary.ensureInjected();

  CopyPlain.scan(messages);
  MessagePdfExport.scan(messages);
  Bookmarks.scan(messages);
  QuickActions.scan(messages, sidebarLinks);
}

const debouncedScan = debounce(runScan, CONFIG.timing.observerDebounceMs);

const observer = new MutationObserver((mutations) => {
  if (isOwnMutation(mutations)) return;
  debouncedScan();
});

function start() {
  Theme.sync();
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
