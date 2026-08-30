// features/char-counter.js - live character count of the composer textarea.
//
// Depends on: config.js (CONFIG).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const CharCounter = {
  update(textarea) {
    const countSpan = document.getElementById(CONFIG.ids.countSpan);
    const counter = document.getElementById(CONFIG.ids.counter);
    if (!countSpan || !counter) return;

    const count = textarea ? textarea.value.length : 0;
    countSpan.textContent = String(count);

    const { warnAt, dangerAt, colors } = CONFIG.charCounter;
    counter.style.color =
      count > dangerAt ? colors.danger : count > warnAt ? colors.warn : colors.normal;
  },
};
