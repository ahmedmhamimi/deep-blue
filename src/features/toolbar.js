// features/toolbar.js - export button + char counter injected into the composer toolbar.
//
// Depends on: config.js, dom.js, features/char-counter.js,
// features/generation-timer.js, pdf/pdf-export.js (PdfExport.run, wired as
// a click handler and called lazily - safe regardless of file order).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Toolbar = {
  isInjected() {
    return !!(
      document.getElementById(CONFIG.ids.exportBtn) && document.getElementById(CONFIG.ids.counter)
    );
  },

  ensureInjected() {
    try {
      if (this.isInjected()) return;

      const sendWrapper = DOM.findSendButtonWrapper();
      if (!sendWrapper || !sendWrapper.parentNode) return;
      const toolbar = sendWrapper.parentNode;

      const exportBtn = document.getElementById(CONFIG.ids.exportBtn) || this._buildExportButton();
      const counter = document.getElementById(CONFIG.ids.counter) || this._buildCounter();

      if (!document.getElementById(CONFIG.ids.exportBtn)) {
        toolbar.insertBefore(exportBtn, sendWrapper);
      }
      if (!document.getElementById(CONFIG.ids.counter)) {
        toolbar.insertBefore(counter, toolbar.firstChild);
      }
      counter.style.order = '-999';
      exportBtn.style.order = '998';
      sendWrapper.style.order = sendWrapper.style.order || '999';

      this._wireCharacterCounter();
    } catch (err) {
      console.debug(`${BRAND_NAME}: toolbar injection error`, err);
    }
  },

  _buildExportButton() {
    const btn = document.createElement('div');
    btn.id = CONFIG.ids.exportBtn;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', `Export conversation as PDF (${BRAND_NAME})`);
    btn.className =
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m';
    btn.style.cssText =
      '--dsl-button-height: 34px; cursor: pointer; flex-shrink: 0; margin-right: 4px;';
    btn.title = `Export conversation as PDF (${BRAND_NAME})`;
    btn.innerHTML = `
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 20H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 4V16M12 16L8 12M12 16L16 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 16H20V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V16Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    </div>`;
    btn.addEventListener('click', PdfExport.run);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        PdfExport.run();
      }
    });
    return btn;
  },

  _buildCounter() {
    const counter = document.createElement('div');
    counter.id = CONFIG.ids.counter;
    counter.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 700;
    color: ${CONFIG.charCounter.colors.normal};
    padding: 0 6px 0 4px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    user-select: none;
    flex-shrink: 0;
    height: 34px;
    letter-spacing: 0.2px;
    margin-right: 4px;
    `;
    counter.innerHTML = `<span id="${CONFIG.ids.countSpan}">0</span><span>characters</span>`;
    counter.title = 'Character count';
    return counter;
  },

  setExportButtonLoading(isLoading) {
    const btn = document.getElementById(CONFIG.ids.exportBtn);
    if (!btn) return;
    btn.style.opacity = isLoading ? '0.6' : '1';
    btn.style.pointerEvents = isLoading ? 'none' : 'auto';
    btn.setAttribute('aria-busy', String(isLoading));
    if (isLoading) {
      btn.dataset.originalTitle = btn.title;
      btn.title = 'Generating PDF...';
    } else if (btn.dataset.originalTitle) {
      btn.title = btn.dataset.originalTitle;
    }
  },

  _charWireDone: false,
  _wireCharacterCounter() {
    const textarea = DOM.findTextarea();
    if (!textarea || this._charWireDone) return;

    CharCounter.update(textarea);
    textarea.addEventListener('input', () => CharCounter.update(textarea));
    textarea.addEventListener('paste', () => setTimeout(() => CharCounter.update(textarea), 0));
    textarea.addEventListener('cut', () => setTimeout(() => CharCounter.update(textarea), 0));

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        GenerationTimer.noteRequestStart();
      }
    });

    document.addEventListener('click', (e) => {
      const target = e.target.closest?.(CONFIG.selectors.primaryCircleButton);
      if (!target || target.id === CONFIG.ids.exportBtn) return;
      GenerationTimer.noteRequestStart();
      for (const delay of CONFIG.timing.postClickRecheckDelaysMs) {
        setTimeout(() => CharCounter.update(DOM.findTextarea()), delay);
      }
    });

    this._charWireDone = true;
  },
};
