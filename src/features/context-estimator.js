// features/context-estimator.js - code-aware token estimate for the whole conversation.
//
// Used only until Bridge reports a real, DeepSeek-provided count.
// Depends on: config.js, dom.js, features/token-counter.js (TokenCounter.estimate).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const ContextEstimator = {
  estimateConversation() {
    const messages = DOM.findMessages();
    let total = 0;
    messages.forEach((message) => {
      total += this._estimateMessage(message);
    });
    return total;
  },

  _estimateMessage(message) {
    const contentRoot = message.querySelector(CONFIG.selectors.markdown) || message;
    const codeBlocks = contentRoot.querySelectorAll('pre');
    let codeChars = 0;
    codeBlocks.forEach((pre) => {
      codeChars += (pre.textContent || '').length;
    });

    const clone = contentRoot.cloneNode(true);
    clone.querySelectorAll('pre').forEach((el) => el.remove());
    const proseText = (clone.textContent || '').replace(/\s+/g, ' ').trim();

    return TokenCounter.estimate(proseText) + this._estimateCodeChars(codeChars);
  },

  _estimateCodeChars(charCount) {
    if (!charCount) return 0;
    return Math.max(1, Math.round(charCount / CONFIG.contextWindow.codeCharsPerToken));
  },
};
