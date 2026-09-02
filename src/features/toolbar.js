// features/toolbar.js - download button + char counter injected into the composer toolbar.
//
// Clicking the download button no longer exports a PDF directly - it opens
// export/download-menu.js's DownloadMenu popover so the person can choose
// PDF, JSON, or plain text first, then routes to the matching exporter
// (pdf/pdf-export.js for PDF, export/format-export.js for JSON/text).
//
// Depends on: config.js, dom.js, utils.js (sanitizeFilename), features/char-counter.js,
// features/generation-timer.js, pdf/extractor.js (Extractor.extract),
// pdf/pdf-export.js (PdfExport.run), export/download-menu.js (DownloadMenu),
// export/format-export.js (FormatExport) - all wired as click handlers and
// called lazily, so this is safe regardless of file order in manifest.json.
// features/copy-plain.js (CopyPlain.copyConversation, same lazy-reference
// pattern - toolbar.js loads before copy-plain.js in manifest.json, but the
// reference is only invoked on click, long after every module has loaded).
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
      if (this.isInjected()) {
        // Elements are present, but the textarea they're wired to may have
        // been swapped out from under us - re-check/re-wire every scan
        // instead of assuming a one-time wire-up is still valid.
        this._wireCharacterCounter();
        this._ensureCopyConversationButton();
        return;
      }

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
      this._ensureCopyConversationButton();
    } catch (err) {
      console.debug(`${BRAND_NAME}: toolbar injection error`, err);
    }
  },

  // Sits immediately to the left of the "export conversation as PDF"
  // button, so the two whole-conversation actions (copy plain text /
  // download PDF) live side by side in the composer toolbar. Injected as
  // a separate step (rather than folded into the block above) so it still
  // gets added/re-checked on scans where isInjected() short-circuits.
  _ensureCopyConversationButton() {
    if (document.getElementById(CONFIG.ids.copyConversationBtn)) return;
    const exportBtn = document.getElementById(CONFIG.ids.exportBtn);
    if (!exportBtn || !exportBtn.parentNode) return;

    const btn = this._buildCopyConversationButton();
    exportBtn.parentNode.insertBefore(btn, exportBtn);
    btn.style.order = '997';
  },

  _buildExportButton() {
    const btn = document.createElement('div');
    btn.id = CONFIG.ids.exportBtn;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', `Download conversation (${BRAND_NAME})`);
    btn.className =
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m';
    btn.style.cssText =
      '--dsl-button-height: 34px; cursor: pointer; flex-shrink: 0; margin-right: 4px;';
    btn.title = `Download conversation (${BRAND_NAME})`;
    btn.innerHTML = `
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 20H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 4V16M12 16L8 12M12 16L16 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 16H20V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V16Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    </div>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Toolbar._openDownloadMenu(btn);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        Toolbar._openDownloadMenu(btn);
      }
    });
    return btn;
  },

  // Opens the format-choice popover anchored to the download button, and
  // routes to the right exporter once a format is picked. PDF reuses the
  // existing whole-conversation pipeline (PdfExport.run, which itself
  // re-extracts the conversation); JSON/text extract once here since
  // there's no heavy render stage to share the way the PDF path has.
  _openDownloadMenu(anchorBtn) {
    if (DownloadMenu.isOpen()) {
      DownloadMenu.close();
      return;
    }
    DownloadMenu.open(anchorBtn, (format) => Toolbar._downloadConversation(format));
  },

  async _downloadConversation(format) {
    if (format === 'pdf') {
      await PdfExport.run();
      return;
    }

    try {
      const conversation = Extractor.extract();
      if (!conversation || !conversation.messages.length) {
        alert('No conversation to export. Please start a chat first.');
        return;
      }
      const baseFilename = sanitizeFilename(conversation.title);
      FormatExport.downloadAs(conversation, baseFilename, format);
    } catch (err) {
      console.error(`${BRAND_NAME}: download failed`, err);
      alert('Failed to download conversation. Please try again.');
    }
  },

  _buildCopyConversationButton() {
    const btn = document.createElement('div');
    btn.id = CONFIG.ids.copyConversationBtn;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', `Copy whole conversation without markdown (${BRAND_NAME})`);
    btn.className =
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m';
    btn.style.cssText =
      '--dsl-button-height: 34px; cursor: pointer; flex-shrink: 0; margin-right: 4px;';
    btn.title = 'Copy whole conversation without markdown';
    btn.innerHTML = `
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">${this._copyIcon()}</div>`;
    btn.addEventListener('click', () => CopyPlain.copyConversation(btn));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        CopyPlain.copyConversation(btn);
      }
    });
    return btn;
  },

  _copyIcon() {
    return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="7" y="7" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 15V4a1 1 0 0 1 1-1h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M9.5 12.3H14.5M9.5 15.3H14.5M9.5 18.3H12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    `;
  },

  _checkIcon() {
    return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    `;
  },

  // Flips a toolbar action button (icon + title) to a success/failure
  // state for a moment, then restores exactly what was there before -
  // works for either the export or copy-conversation button since both
  // share the same "background + icon" inner markup.
  flashToolbarButton(btn, success, failTitle) {
    if (!btn) return;
    const originalHTML = btn.innerHTML;
    const originalTitle = btn.title;
    btn.innerHTML = `
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">${
      success ? this._checkIcon() : this._copyIcon()
    }</div>`;
    btn.title = success ? 'Copied!' : failTitle || 'Could not copy. Please try again.';
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.title = originalTitle;
    }, 1200);
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
    font-family: var(--db-font);
    user-select: none;
    flex-shrink: 0;
    height: 34px;
    letter-spacing: 0.2px;
    margin-right: 4px;
    transition: color var(--db-base) var(--db-ease);
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

  _wiredTextarea: null,
  _clickListenerAdded: false,
  _wireCharacterCounter() {
    const textarea = DOM.findTextarea();
    if (!textarea) return;

    // DeepSeek is an SPA: the composer <textarea> node itself can be
    // swapped out (route change, mode switch, first-message layout shift)
    // while our injected toolbar elements survive. Re-wiring was previously
    // gated behind a one-shot flag, so if the textarea wasn't found on the
    // very first pass - or got replaced later - the counter was silently
    // wired to a dead element (or never wired at all) and stayed at 0
    // forever. Instead, only skip when we're already wired to this exact,
    // still-attached node.
    if (this._wiredTextarea === textarea && textarea.isConnected) {
      CharCounter.update(textarea);
      return;
    }

    CharCounter.update(textarea);
    textarea.addEventListener('input', () => CharCounter.update(textarea));
    textarea.addEventListener('paste', () => setTimeout(() => CharCounter.update(textarea), 0));
    textarea.addEventListener('cut', () => setTimeout(() => CharCounter.update(textarea), 0));

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        GenerationTimer.noteRequestStart();
      }
    });

    this._wiredTextarea = textarea;

    // This listener doesn't depend on the textarea node, so it only needs
    // to be attached once (it always re-queries DOM.findTextarea() at
    // click time, so it naturally follows any element swap).
    if (!this._clickListenerAdded) {
      document.addEventListener('click', (e) => {
        const target = e.target.closest?.(CONFIG.selectors.primaryCircleButton);
        // Skip DeepBlue's own buttons (export/copy-conversation/etc) - only
        // a real send click should start the generation timer. See
        // isDeepBlueOwnedElement in utils.js.
        if (!target || isDeepBlueOwnedElement(target)) return;
        GenerationTimer.noteRequestStart();
        for (const delay of CONFIG.timing.postClickRecheckDelaysMs) {
          setTimeout(() => CharCounter.update(DOM.findTextarea()), delay);
        }
      });
      this._clickListenerAdded = true;
    }
  },
};
