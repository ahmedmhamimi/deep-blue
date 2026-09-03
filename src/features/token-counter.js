// features/token-counter.js - per-message estimated token count badges.
//
// Depends on: config.js, dom.js, utils.js (escapeHtml),
// features/generation-timer.js.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const TokenCounter = {
  _processed: new WeakSet(),

  estimate(text) {
    if (!text) return 0;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean.length) return 0;

    const cjkMatches = clean.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const otherCount = clean.length - cjkCount;

    const tokens =
      cjkCount / CONFIG.tokenCounter.cjkCharsPerToken +
      otherCount / CONFIG.tokenCounter.latinCharsPerToken;

    return Math.max(1, Math.round(tokens));
  },

  scan(messages) {
    try {
      (messages || DOM.findMessages()).forEach((message) => this._processMessage(message));
    } catch (err) {
      console.debug(`${BRAND_NAME}: token counter error`, err);
    }
  },

  _isAssistantMessage(message) {
    const looksLikeUser =
      message.classList.contains('d29f3d7d') ||
      message.querySelector(CONFIG.selectors.userMessageMarker) !== null;
    return !looksLikeUser;
  },

  _processMessage(message) {
    if (this._processed.has(message)) return;
    if (message.querySelector('.deepblue-token-counter')) {
      this._processed.add(message);
      return;
    }
    if (!this._isAssistantMessage(message)) return;

    const markdown = message.querySelector(CONFIG.selectors.markdown);
    if (!markdown) return;

    const actionRow = queryFirst(
      CONFIG.selectors.messageActionRow,
      message.parentElement || document
    );
    const buttonRow = actionRow ? queryFirst(CONFIG.selectors.messageButtonRow, actionRow) : null;
    if (!buttonRow) return;

    const tokenCount = this.estimate(markdown.textContent);
    const elapsedSeconds = GenerationTimer.consumeElapsedSeconds();

    buttonRow.insertBefore(
      this._buildBadge(tokenCount, elapsedSeconds),
      this._findInsertAnchor(buttonRow)
    );
    this._processed.add(message);
  },

  _findInsertAnchor(buttonRow) {
    return (
      buttonRow.querySelector(CONFIG.selectors.shareButton) || buttonRow.lastElementChild || null
    );
  },

  _buildBadge(tokenCount, elapsedSeconds) {
    const badge = document.createElement('div');
    badge.className = 'deepblue-token-counter';
    badge.style.cssText = `
 display: inline-flex;
 align-items: center;
 gap: 4px;
 font-size: 11px;
 font-weight: 600;
 color: var(--db-text-secondary);
 padding: 0 6px;
 font-family: var(--db-font);
 user-select: none;
 height: 28px;
 letter-spacing: 0.2px;
 border-left: 1px solid var(--db-border);
 margin-left: 4px;
 padding-left: 10px;
 `;

    const timeLabel = GenerationTimer.format(elapsedSeconds);
    badge.dataset.dbTip = timeLabel
      ? Lang.t('tokenCounter.title.withTime', { tokens: tokenCount, time: timeLabel })
      : Lang.t('tokenCounter.title', { tokens: tokenCount });

    badge.innerHTML = `
 <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.85;">
 <path d="M8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0ZM8 14C4.69 14 2 11.31 2 8C2 4.69 4.69 2 8 2C11.31 2 14 4.69 14 8C14 11.31 11.31 14 8 14Z" fill="currentColor"/>
 <path d="M8 4C7.45 4 7 4.45 7 5V8.5L9.2 10.7C9.6 11.1 10.2 11.1 10.6 10.7C11 10.3 11 9.7 10.6 9.3L9 7.7V5C9 4.45 8.55 4 8 4Z" fill="currentColor"/>
 </svg>
 <span>${tokenCount}</span>
 <span style="font-weight: 500; font-size: 10px; opacity: 0.9;">${Lang.t('tokenCounter.unit')}</span>
 ${
   timeLabel
     ? `<span style="opacity: 0.6;">&middot;</span>
   <span>${escapeHtml(timeLabel)}</span>`
     : ''
 }
 `;
    return badge;
  },
};
