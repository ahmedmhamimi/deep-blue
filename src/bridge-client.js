// bridge-client.js - relays exact token-usage numbers from the page's main world.
//
// Injects deepblue-bridge.js (a separate, web-accessible script that runs in
// the page's own JS context) and listens for postMessage updates from it.
// Depends on: config.js (BRAND_NAME).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Bridge = {
  MSG_TYPE: '__deepblue_bridge_token_usage__',
  scriptId: 'deepblue-bridge-script',
  latestTokenUsage: null,
  latestModelType: null,

  inject() {
    if (document.getElementById(this.scriptId)) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return;
    const script = document.createElement('script');
    script.id = this.scriptId;
    script.src = chrome.runtime.getURL('deepblue-bridge.js');
    script.onload = () => script.remove();
    script.onerror = () => {
      console.debug(
        `${BRAND_NAME}: bridge script failed to load - falling back to estimation only.`
      );
    };
    (document.head || document.documentElement).appendChild(script);
  },

  listen() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'deepblue-bridge' || data.type !== this.MSG_TYPE) return;
      if (typeof data.tokenUsage === 'number') this.latestTokenUsage = data.tokenUsage;
      if (typeof data.modelType === 'string') this.latestModelType = data.modelType;
    });
  },
};
