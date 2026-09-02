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
  // message element -> { length, tokens }. Historical messages never
  // change once rendered, but estimateConversation() used to redo the
  // full cloneNode()+strip-code-blocks+regex work for every message on
  // every ~300ms scan tick regardless - for a long conversation, that's
  // O(entire transcript) of wasted DOM cloning repeated dozens of times
  // over a single reply's generation. A WeakMap cache, keyed by the
  // message's own element, lets every finished message skip straight to
  // its cached total; only the one message still actively streaming (its
  // text length keeps changing) ever gets recomputed. Keying by the live
  // DOM node also makes this self-cleaning: if a message's node is ever
  // discarded (e.g. sidebar virtualization), the cache entry is garbage
  // collected right along with it - nothing to manually evict.
  _cache: new WeakMap(),

  estimateConversation(messages) {
    const list = messages || DOM.findMessages();
    let total = 0;
    list.forEach((message) => {
      total += this._estimateMessageCached(message);
    });
    return total;
  },

  _estimateMessageCached(message) {
    const contentRoot = message.querySelector(CONFIG.selectors.markdown) || message;
    const length = contentRoot.textContent.length;
    const cached = this._cache.get(message);
    if (cached && cached.length === length) return cached.tokens;

    const tokens = this._estimateMessage(contentRoot);
    this._cache.set(message, { length, tokens });
    return tokens;
  },

  _estimateMessage(contentRoot) {
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
