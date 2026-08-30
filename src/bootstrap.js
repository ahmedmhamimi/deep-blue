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
// SidebarSearch, Folders).

'use strict';

function isOwnMutation(mutations) {
  return mutations.every((m) => {
    const node = m.target;
    return (
      node?.id?.startsWith?.('deepblue-') ||
      node?.closest?.(`#${CONFIG.ids.renderStage}`) ||
      node?.closest?.(`#${CONFIG.ids.contextMeter}`) ||
      node?.closest?.(`#${CONFIG.ids.searchBar}`) ||
      node?.closest?.(`#${CONFIG.ids.sidebarSearchBar}`) ||
      node?.closest?.(`#${CONFIG.ids.folderSection}`) ||
      node?.closest?.(`#${CONFIG.ids.folderMenu}`) ||
      node?.classList?.contains?.('deepblue-token-counter') ||
      node?.classList?.contains?.('deepblue-search-highlight') ||
      node?.classList?.contains?.('deepblue-add-to-folder-btn') ||
      node?.dataset?.deepblueFolderized === '1'
    );
  });
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
