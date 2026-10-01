// export/loading-overlay.js - a small, persistent "working on it" pill with
// a spinning icon, shown for the one export path slow enough to actually
// need it: PDF generation (html2canvas rasterizing the whole conversation,
// then jsPDF assembling pages). JSON/text export is just string-building +
// a Blob - effectively instant - so it never needs this.
//
// Distinct from the tiny spin icon toolbar.js/message-pdf-export.js already
// swap into the button itself: that's easy to miss (especially on the
// small per-message button), while this sits front-and-center so there's
// no doubt an export is in progress during a multi-second wait.
//
// Depends on: utils.js (escapeHtml).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const LoadingOverlay = {
  _el: null,
  _hideTimer: null,

  // Shows (or updates the text of) the persistent loading pill. Safe to
  // call again while already showing - nothing extra happens, the message
  // just updates in place.
  show(text) {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }

    if (this._el) {
      this._setState('loading');
      this._el.innerHTML = `
      <span class="deepblue-loading-overlay__icon">${this._spinnerSvg()}</span>
      <span class="deepblue-loading-overlay__text">${escapeHtml(text || Lang.t('loading.working'))}</span>
      `;
      return;
    }

    this._injectStyles();

    const el = document.createElement('div');
    el.id = 'deepblue-loading-overlay';
    el.className = 'deepblue-loading-overlay deepblue-loading-overlay--loading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
    <span class="deepblue-loading-overlay__icon">${this._spinnerSvg()}</span>
    <span class="deepblue-loading-overlay__text">${escapeHtml(text || Lang.t('loading.working'))}</span>
    `;
    document.body.appendChild(el);
    this._el = el;

    // Let the browser paint the initial (offscreen) state before animating
    // in, so the transition actually plays instead of snapping.
    requestAnimationFrame(() => el.classList.add('deepblue-loading-overlay--visible'));
  },

  // Briefly flips the pill to a success/failure state (check or x, no more
  // spinning), then fades it out on its own - callers don't need to call
  // hide() themselves after this.
  finish(success, text) {
    if (!this._el) return;
    this._setState(success ? 'success' : 'error');
    this._el.innerHTML = `
    <span class="deepblue-loading-overlay__icon">${success ? this._checkSvg() : this._errorSvg()}</span>
    <span class="deepblue-loading-overlay__text">${escapeHtml(
      text || (success ? Lang.t('loading.done') : Lang.t('loading.error'))
    )}</span>
    `;
    this._hideTimer = setTimeout(() => this.hide(), success ? 1400 : 2200);
  },

  hide() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    const el = this._el;
    if (!el) return;
    this._el = null;
    el.classList.remove('deepblue-loading-overlay--visible');
    setTimeout(() => el.remove(), 200);
  },

  _setState(state) {
    if (!this._el) return;
    this._el.classList.remove(
      'deepblue-loading-overlay--loading',
      'deepblue-loading-overlay--success',
      'deepblue-loading-overlay--error'
    );
    this._el.classList.add(`deepblue-loading-overlay--${state}`);
  },

  _spinnerSvg() {
    return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite"/>
    </path>
    </svg>
    `;
  },

  _checkSvg() {
    return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 13l4 4L19 7" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    `;
  },

  _errorSvg() {
    return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 6l12 12M18 6L6 18" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
    `;
  },

  _injectStyles() {
    if (document.getElementById('deepblue-loading-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-loading-overlay-styles';
    style.textContent = `
    .deepblue-loading-overlay {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translate(-50%, 8px);
      z-index: 1000001;
      display: flex;
      align-items: center;
      gap: 9px;
      background: var(--db-text);
      color: var(--db-surface);
      font-size: 13px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      padding: 10px 16px;
      border-radius: 999px;
      box-shadow: var(--db-shadow-lg);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.18s ease;
      white-space: nowrap;
    }
    .deepblue-loading-overlay--visible { opacity: 1; transform: translate(-50%, 0); }
    .deepblue-loading-overlay__icon { display: flex; flex-shrink: 0; color: var(--db-surface); }
    .deepblue-loading-overlay--loading .deepblue-loading-overlay__icon { color: #a8b6ff; }
    `;
    document.head.appendChild(style);
  },
};
