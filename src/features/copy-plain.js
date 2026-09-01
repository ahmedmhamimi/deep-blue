// features/copy-plain.js - adds a "copy without markdown" button to each
// assistant response's action row (alongside DeepSeek's own Copy /
// Regenerate / Share buttons), which copies the response as clean plain
// text instead of raw markdown.
//
// Reuses the exact same selectors/insertion pattern as token-counter.js
// (already proven against the real site), rather than inventing a new
// overlay position, so it sits naturally next to the other per-message
// actions.
//
// Depends on: config.js, dom.js, utils.js (queryFirst, htmlNodeToPlainText).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const CopyPlain = {
  _processed: new WeakSet(),

  scan() {
    try {
      const messages = DOM.findMessages();
      messages.forEach((message) => this._processMessage(message));
    } catch (err) {
      console.debug(`${BRAND_NAME}: copy-without-markdown error`, err);
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
    if (message.querySelector('.deepblue-copy-plain-btn')) {
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

    const anchor =
      buttonRow.querySelector(CONFIG.selectors.shareButton) || buttonRow.lastElementChild || null;
    buttonRow.insertBefore(this._buildButton(markdown), anchor);
    this._processed.add(message);
  },

  _buildButton(markdownEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deepblue-copy-plain-btn';
    btn.title = 'Copy without markdown formatting';
    btn.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 50%; border: none; background: none;
    color: #6c6c72; cursor: pointer; padding: 0; margin-left: 2px; flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
    `;
    btn.innerHTML = this._icon();

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#f0f1f4';
      btn.style.color = '#1d1d1f';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
      btn.style.color = '#6c6c72';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._copy(markdownEl, btn);
    });

    return btn;
  },

  async _copy(markdownEl, btn) {
    const text = htmlNodeToPlainText(markdownEl);
    try {
      await navigator.clipboard.writeText(text);
      this._flash(btn, true);
    } catch (err) {
      console.debug(`${BRAND_NAME}: clipboard write failed`, err);
      this._flash(btn, false);
    }
  },

  _flash(btn, success) {
    const original = btn.innerHTML;
    btn.innerHTML = success ? this._checkIcon() : this._icon();
    btn.title = success ? 'Copied!' : 'Copy without markdown formatting';
    setTimeout(() => {
      btn.innerHTML = original;
      btn.title = 'Copy without markdown formatting';
    }, 1200);
  },

  _icon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="7" y="7" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <path d="M5 15V4a1 1 0 0 1 1-1h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M9.5 12.3H14.5M9.5 15.3H14.5M9.5 18.3H12.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    `;
  },

  _checkIcon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 13l4 4L19 7" stroke="#22c55e" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    `;
  },
};
