// content.js - DeepBlue: Export DeepSeek Conversation as PDF (direct save, no print dialog)
//
// Structure:
//   CONFIG            - all selectors / tunables in one place, with fallback chains
//   DOM               - element lookups (memoized where safe, always re-verified)
//   CharCounter       - live character count of the composer textarea
//   Bridge            - talks to deepblue-bridge.js (injected into the page's main
//                       world) to get exact, DeepSeek-reported token counts
//   GenerationTimer   - wall-clock time between send and a response finishing
//   ContextEstimator  - code-aware token estimate, used only until the Bridge
//                       reports a real number for the current chat
//   ContextMeter      - context-window progress bar UI (next to Search toggle)
//   TokenCounter      - per-message estimated token badges
//   ChatSearch        - in-chat search bar with next/prev navigation
//   PdfExport         - conversation extraction + off-screen render + jsPDF assembly
//   Bootstrap         - single MutationObserver that drives everything, with a guard
//                       against reacting to DeepBlue's own DOM writes

(function () {
  'use strict';

  const BRAND_NAME = 'DeepBlue';

  const CONFIG = {
    ids: {
      exportBtn: 'deepblue-export-pdf-btn',
      counter: 'deepblue-char-counter',
      countSpan: 'deepblue-char-count',
      renderStage: 'deepblue-pdf-render-stage',
      contextMeter: 'deepblue-context-meter',
      searchBar: 'deepblue-chat-search',
      searchInput: 'deepblue-search-input',
      searchPrev: 'deepblue-search-prev',
      searchNext: 'deepblue-search-next',
      searchCount: 'deepblue-search-count',
      searchClear: 'deepblue-search-clear',
    },
    selectors: {
      fileInput: 'input[type="file"][multiple], input[type="file"]',
      textarea: [
        'textarea._27c9245',
        'textarea[placeholder*="Message DeepSeek"]',
        'textarea[placeholder*="Send a message"]',
      ],
      messages: ['.ds-message._63c77b1', '[class*="ds-message"]'],
      userMessageMarker: '.fbb737a4',
      markdown: '.ds-markdown',
      title: ['.afa34042', '.d00ed9c9'],
      titleContainer: ['.afa34042', '.d00ed9c9'],
      messageActionRow: ['.ds-flex._0a3d93b', '._0a3d93b'],
      messageButtonRow: ['.ds-flex._965abe9'],
      shareButton: '.ds-button[title*="Share" i]',
      primaryCircleButton: '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle',
      fitContentWrapper: 'div[style*="width: fit-content"]',
      headerContainer: 'header, .ds-header, [class*="header"]',
      virtualListItems: '.ds-virtual-list-items._6f2c522',
      visibleItems: '.ds-virtual-list-visible-items',
    },
    charCounter: {
      warnAt: 500,
      dangerAt: 1000,
      colors: { normal: '#8e8e93', warn: '#feca57', danger: '#ff6b6b' },
    },
    tokenCounter: {
      latinCharsPerToken: 4,
      cjkCharsPerToken: 1.6,
    },
    contextWindow: {
      codeCharsPerToken: 3.0,
      limit: 1048576,
    },
    timing: {
      initialScanDelayMs: 1200,
      observerDebounceMs: 300,
      postClickRecheckDelaysMs: [0, 120, 350],
    },
    pdf: {
      pageWidthPt: 595.28,
      pageHeightPt: 841.89,
      marginPt: 36,
      contentWidthPx: 760,
      renderScale: 2,
      jpegQuality: 0.95,
      blockSpacingPt: 10,
    },
  };

  // ---------------------------------------------------------------------
  // Small shared utilities
  // ---------------------------------------------------------------------

  function debounce(fn, waitMs) {
    let handle = null;
    return function debounced(...args) {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        fn.apply(this, args);
      }, waitMs);
    };
  }

  function queryFirst(selectors, root = document) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  const escapeSink = document.createElement('div');
  function escapeHtml(text) {
    escapeSink.textContent = text == null ? '' : String(text);
    return escapeSink.innerHTML;
  }

  function sanitizeFilename(name) {
    return (
      (name || 'DeepSeek-Conversation')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'DeepSeek-Conversation'
    );
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // ---------------------------------------------------------------------
  // DOM lookups
  // ---------------------------------------------------------------------

  const DOM = {
    findSendButtonWrapper() {
      const fileInput = document.querySelector(CONFIG.selectors.fileInput);
      const scope = fileInput?.closest('.bf38813a') || fileInput?.parentElement || document;
      const wrapper =
      scope.querySelector(CONFIG.selectors.fitContentWrapper) ||
      scope.querySelector(CONFIG.selectors.primaryCircleButton)?.closest(CONFIG.selectors.fitContentWrapper);
      return wrapper || scope.querySelector?.(CONFIG.selectors.primaryCircleButton)?.parentElement || null;
    },

 findTextarea() {
   return queryFirst(CONFIG.selectors.textarea);
 },

 findMessages() {
   const primary = document.querySelectorAll(CONFIG.selectors.messages[0]);
   if (primary.length) return primary;
   return document.querySelectorAll(CONFIG.selectors.messages[1]);
 },

 findConversationTitle() {
   const el = queryFirst(CONFIG.selectors.title);
   return el?.textContent?.trim() || 'DeepSeek Conversation';
 },

 findTitleContainer() {
   const el = queryFirst(CONFIG.selectors.titleContainer);
   return el?.parentElement || el?.closest('div') || null;
 },

 findComposerModeRow() {
   const textarea = this.findTextarea();
   const scope = textarea?.closest('form') || textarea?.parentElement?.parentElement?.parentElement || document;
   const candidates = scope.querySelectorAll('div, button, span');
   for (const el of candidates) {
     if (el.children.length > 0) continue;
     if (el.textContent?.trim().toLowerCase() !== 'search') continue;
     let row = el.parentElement;
     for (let i = 0; i < 3 && row; i++) {
       if (row.textContent?.toLowerCase().includes('deepthink')) return row;
       row = row.parentElement;
     }
     return el.parentElement;
   }
   return null;
 },

 findHeaderContainer() {
   const el = queryFirst(CONFIG.selectors.titleContainer);
   if (el) {
     let parent = el.parentElement;
     let attempts = 0;
     while (parent && attempts < 10) {
       const tag = parent.tagName?.toLowerCase() || '';
       if (tag === 'header' ||
         parent.className?.includes?.('header') ||
         parent.className?.includes?.('title-bar') ||
         parent.className?.includes?.('conversation-header')) {
         return parent;
         }
         parent = parent.parentElement;
       attempts++;
     }
     return el.closest('header') || el.closest('[class*="header"]') || el.parentElement?.parentElement || null;
   }
   return null;
 },

 getVisibleMessageElements() {
   // Get all message elements that are currently rendered in the virtual list
   const visibleContainer = document.querySelector(CONFIG.selectors.visibleItems);
   if (!visibleContainer) return [];

   const messageElements = visibleContainer.querySelectorAll(CONFIG.selectors.messages[0]);
   if (messageElements.length) return messageElements;
   return visibleContainer.querySelectorAll(CONFIG.selectors.messages[1]);
 },

 getAllMessageElements() {
   // Get all message containers from the virtual list items
   const virtualItems = document.querySelectorAll('[data-virtual-list-item-key]');
   const messages = [];
   virtualItems.forEach((item) => {
     const msg = item.querySelector(CONFIG.selectors.messages[0]) ||
     item.querySelector(CONFIG.selectors.messages[1]);
     if (msg) messages.push(msg);
   });
     return messages.length ? messages : this.findMessages();
 }
  };

  // ---------------------------------------------------------------------
  // Toolbar injection: PDF export button + live character counter
  // ---------------------------------------------------------------------

  const Toolbar = {
    isInjected() {
      return !!(document.getElementById(CONFIG.ids.exportBtn) && document.getElementById(CONFIG.ids.counter));
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
      btn.style.cssText = '--dsl-button-height: 34px; cursor: pointer; flex-shrink: 0; margin-right: 4px;';
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

  // ---------------------------------------------------------------------
  // Character counter
  // ---------------------------------------------------------------------

  const CharCounter = {
    update(textarea) {
      const countSpan = document.getElementById(CONFIG.ids.countSpan);
      const counter = document.getElementById(CONFIG.ids.counter);
      if (!countSpan || !counter) return;

      const count = textarea ? textarea.value.length : 0;
      countSpan.textContent = String(count);

      const { warnAt, dangerAt, colors } = CONFIG.charCounter;
      counter.style.color = count > dangerAt ? colors.danger : count > warnAt ? colors.warn : colors.normal;
    },
  };

  // ---------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------

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
        console.debug(`${BRAND_NAME}: bridge script failed to load - falling back to estimation only.`);
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

  // ---------------------------------------------------------------------
  // Generation timer
  // ---------------------------------------------------------------------

  const GenerationTimer = {
    _pendingStartTime: null,

    noteRequestStart() {
      this._pendingStartTime = Date.now();
    },

    consumeElapsedSeconds() {
      if (this._pendingStartTime == null) return null;
      const elapsedMs = Date.now() - this._pendingStartTime;
      this._pendingStartTime = null;
      return elapsedMs / 1000;
    },

    format(seconds) {
      if (seconds == null || !isFinite(seconds) || seconds < 0) return null;
      if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    },
  };

  // ---------------------------------------------------------------------
  // Context estimator
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Context meter
  // ---------------------------------------------------------------------

  const ContextMeter = {
    ensureInjected() {
      if (document.getElementById(CONFIG.ids.contextMeter)) return;
      const row = DOM.findComposerModeRow();
      if (!row) return;
      row.appendChild(this._build());
    },

    _build() {
      const wrap = document.createElement('div');
      wrap.id = CONFIG.ids.contextMeter;
      wrap.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #8e8e93;
      user-select: none;
      margin-left: 8px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid #e9ecf0;
      vertical-align: middle;
      `;
      wrap.innerHTML = `
      <div style="width: 54px; height: 5px; border-radius: 3px; background: #e9ecf0; overflow: hidden; flex-shrink: 0;">
      <div class="deepblue-context-fill" style="height: 100%; width: 0%; background: #3964fe; transition: width 200ms ease, background-color 200ms ease;"></div>
      </div>
      <span class="deepblue-context-label">0%</span>
      `;
      return wrap;
    },

    scan() {
      try {
        this.ensureInjected();
        const el = document.getElementById(CONFIG.ids.contextMeter);
        if (!el) return;

        const exactTokens = Bridge.latestTokenUsage;
        const isExact = typeof exactTokens === 'number';
        const tokens = isExact ? exactTokens : ContextEstimator.estimateConversation();

        const limit = CONFIG.contextWindow.limit;
        const pct = limit > 0 ? Math.min(100, (tokens / limit) * 100) : 0;

        const fill = el.querySelector('.deepblue-context-fill');
        const label = el.querySelector('.deepblue-context-label');
        if (fill) {
          fill.style.width = `${pct.toFixed(1)}%`;
          fill.style.background = pct > 90 ? '#ff6b6b' : pct > 70 ? '#feca57' : '#3964fe';
        }
        if (label) {
          label.textContent = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
        }

        el.title = isExact
        ? `${tokens.toLocaleString()} / ${limit.toLocaleString()} tokens (exact, reported by DeepSeek)`
        : `~${tokens.toLocaleString()} / ${limit.toLocaleString()} tokens estimated\n` +
        `Estimate only - waiting on the first response to get an exact count from DeepSeek.`;
      } catch (err) {
        console.debug(`${BRAND_NAME}: context meter error`, err);
      }
    },
  };

  // ---------------------------------------------------------------------
  // Token counter
  // ---------------------------------------------------------------------

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
   cjkCount / CONFIG.tokenCounter.cjkCharsPerToken + otherCount / CONFIG.tokenCounter.latinCharsPerToken;

   return Math.max(1, Math.round(tokens));
 },

 scan() {
   try {
     const messages = DOM.findMessages();
     messages.forEach((message) => this._processMessage(message));
   } catch (err) {
     console.debug(`${BRAND_NAME}: token counter error`, err);
   }
 },

 _isAssistantMessage(message) {
   const looksLikeUser =
   message.classList.contains('d29f3d7d') || message.querySelector(CONFIG.selectors.userMessageMarker) !== null;
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

   const actionRow = queryFirst(CONFIG.selectors.messageActionRow, message.parentElement || document);
   const buttonRow = actionRow ? queryFirst(CONFIG.selectors.messageButtonRow, actionRow) : null;
   if (!buttonRow) return;

   const tokenCount = this.estimate(markdown.textContent);
   const elapsedSeconds = GenerationTimer.consumeElapsedSeconds();

   buttonRow.insertBefore(this._buildBadge(tokenCount, elapsedSeconds), this._findInsertAnchor(buttonRow));
   this._processed.add(message);
 },

 _findInsertAnchor(buttonRow) {
   return buttonRow.querySelector(CONFIG.selectors.shareButton) || buttonRow.lastElementChild || null;
 },

 _buildBadge(tokenCount, elapsedSeconds) {
   const badge = document.createElement('div');
   badge.className = 'deepblue-token-counter';
   badge.style.cssText = `
   display: inline-flex;
   align-items: center;
   gap: 4px;
   font-size: 11px;
   font-weight: 500;
   color: #8e8e93;
   padding: 0 6px;
   font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
   user-select: none;
   height: 28px;
   letter-spacing: 0.2px;
   opacity: 0.7;
   border-left: 1px solid #e9ecf0;
   margin-left: 4px;
   padding-left: 10px;
   `;

   const timeLabel = GenerationTimer.format(elapsedSeconds);
   badge.title = timeLabel
   ? `Estimated tokens: ${tokenCount} \u00b7 Generated in ${timeLabel}`
   : `Estimated tokens: ${tokenCount}`;

   badge.innerHTML = `
   <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.6;">
   <path d="M8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0ZM8 14C4.69 14 2 11.31 2 8C2 4.69 4.69 2 8 2C11.31 2 14 4.69 14 8C14 11.31 11.31 14 8 14Z" fill="currentColor"/>
   <path d="M8 4C7.45 4 7 4.45 7 5V8.5L9.2 10.7C9.6 11.1 10.2 11.1 10.6 10.7C11 10.3 11 9.7 10.6 9.3L9 7.7V5C9 4.45 8.55 4 8 4Z" fill="currentColor"/>
   </svg>
   <span>${tokenCount}</span>
   <span style="font-weight: 400; font-size: 10px; opacity: 0.7;">tokens</span>
   ${
     timeLabel
     ? `<span style="opacity: 0.4;">&middot;</span>
     <span>${escapeHtml(timeLabel)}</span>`
     : ''
   }
   `;
   return badge;
 },
  };

  // ---------------------------------------------------------------------
  // Chat search - FIXED: Works with DeepSeek's virtual list
  // ---------------------------------------------------------------------

  const ChatSearch = {
    _searchResults: [],
    _currentIndex: -1,
    _isSearching: false,
    _observer: null,

    ensureInjected() {
      if (document.getElementById(CONFIG.ids.searchBar)) return;

      const header = DOM.findHeaderContainer();
      if (!header) {
        const titleContainer = DOM.findTitleContainer();
        if (!titleContainer) return;

        let parent = titleContainer.parentElement;
        let attempts = 0;
        while (parent && attempts < 5) {
          const style = window.getComputedStyle(parent);
          if (style.display === 'flex' || style.display === 'inline-flex') {
            break;
          }
          parent = parent.parentElement;
          attempts++;
        }
        if (parent) {
          parent.appendChild(this._build());
        }
        return;
      }

      header.appendChild(this._build());

      // Set up a MutationObserver to watch for new messages appearing
      this._setupObserver();
    },

    _setupObserver() {
      if (this._observer) return;

      this._observer = new MutationObserver(() => {
        // If we have an active search, re-run it when new messages appear
        const input = document.getElementById(CONFIG.ids.searchInput);
        if (input && input.value.trim()) {
          this._performSearch(input.value);
        }
      });

      // Watch the virtual list container for changes
      const container = document.querySelector(CONFIG.selectors.virtualListItems) ||
      document.querySelector('.ds-virtual-list-visible-items');
      if (container) {
        this._observer.observe(container, { childList: true, subtree: true });
      }
    },

    _build() {
      const container = document.createElement('div');
      container.id = CONFIG.ids.searchBar;
      container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 12px;
      padding: 4px 10px;
      background: #f0f2f5;
      border-radius: 20px;
      border: 1.5px solid transparent;
      transition: all 0.25s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      flex-shrink: 0;
      min-width: 200px;
      `;

      container.addEventListener('focusin', () => {
        container.style.background = '#ffffff';
        container.style.borderColor = '#3964fe';
        container.style.boxShadow = '0 0 0 3px rgba(57, 100, 254, 0.15)';
      });

      container.addEventListener('focusout', () => {
        container.style.background = '#f0f2f5';
        container.style.borderColor = 'transparent';
        container.style.boxShadow = 'none';
      });

      container.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0; opacity: 0.5; transition: opacity 0.2s;">
      <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
      <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input id="${CONFIG.ids.searchInput}" type="text" placeholder="Search in conversation..." style="
      border: none;
      background: transparent;
      outline: none;
      font-size: 13px;
      padding: 6px 0;
      width: 160px;
      min-width: 120px;
      color: #1d1d1f;
      font-family: inherit;
      transition: width 0.3s ease;
      ">
      <span id="${CONFIG.ids.searchCount}" style="
      font-size: 12px;
      color: #8e8e93;
      min-width: 42px;
      text-align: center;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      opacity: 0.7;
      ">0</span>
      <div style="display: flex; align-items: center; gap: 2px; border-left: 1px solid #d0d5dd; padding-left: 6px;">
      <button id="${CONFIG.ids.searchPrev}" style="
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 6px;
      color: #6c6c72;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      transition: all 0.15s ease;
      opacity: 0.5;
      " title="Previous match (↑)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 15L12 9L6 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      </button>
      <button id="${CONFIG.ids.searchNext}" style="
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 6px;
      color: #6c6c72;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      transition: all 0.15s ease;
      opacity: 0.5;
      " title="Next match (↓)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      </button>
      </div>
      <button id="${CONFIG.ids.searchClear}" style="
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 4px;
      color: #8e8e93;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      transition: all 0.15s ease;
      opacity: 0;
      pointer-events: none;
      " title="Clear search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      </button>
      `;

      const prevBtn = container.querySelector(`#${CONFIG.ids.searchPrev}`);
      const nextBtn = container.querySelector(`#${CONFIG.ids.searchNext}`);
      const clearBtn = container.querySelector(`#${CONFIG.ids.searchClear}`);

      [prevBtn, nextBtn].forEach(btn => {
        if (!btn) return;
        btn.addEventListener('mouseenter', () => {
          btn.style.background = '#e4e7ed';
          btn.style.color = '#1d1d1f';
          btn.style.opacity = '1';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = 'none';
          btn.style.color = '#6c6c72';
          btn.style.opacity = this._searchResults.length > 0 ? '0.7' : '0.5';
        });
      });

      if (clearBtn) {
        clearBtn.addEventListener('mouseenter', () => {
          clearBtn.style.background = '#fee2e2';
          clearBtn.style.color = '#dc2626';
        });
        clearBtn.addEventListener('mouseleave', () => {
          clearBtn.style.background = 'none';
          clearBtn.style.color = '#8e8e93';
        });
      }

      const input = container.querySelector(`#${CONFIG.ids.searchInput}`);

      if (input) {
        input.addEventListener('input', () => {
          this._performSearch(input.value);
        });

        input.addEventListener('focus', () => {
          container.style.background = '#ffffff';
          container.style.borderColor = '#3964fe';
          container.style.boxShadow = '0 0 0 3px rgba(57, 100, 254, 0.15)';
        });

        input.addEventListener('blur', () => {
          if (!input.value) {
            container.style.background = '#f0f2f5';
            container.style.borderColor = 'transparent';
            container.style.boxShadow = 'none';
          }
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._navigate(-1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._navigate(1);
          } else if (e.key === 'Escape') {
            this.clear();
          }
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', () => this._navigate(-1));
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => this._navigate(1));
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', () => this.clear());
      }

      return container;
    },

    _performSearch(query) {
      // Guard against re-entrancy: the observer below can fire while we're
      // still writing highlights for a previous call.
      if (this._isSearching) return;
      this._isSearching = true;

      // Highlighting mutates the chat DOM (the same subtree _setupObserver
      // watches), so pause the observer while we write, or every highlight
      // we insert triggers another _performSearch and the tab hard-locks.
      if (this._observer) this._observer.disconnect();

      try {
        this._performSearchInner(query);
      } finally {
        this._isSearching = false;
        if (this._observer) {
          const container = document.querySelector(CONFIG.selectors.virtualListItems) ||
          document.querySelector('.ds-virtual-list-visible-items');
          if (container) {
            this._observer.observe(container, { childList: true, subtree: true });
          }
        }
      }
    },

    _performSearchInner(query) {
      this._clearHighlights();
      this._searchResults = [];
      this._currentIndex = -1;

      const input = document.getElementById(CONFIG.ids.searchInput);
      const clearBtn = document.getElementById(CONFIG.ids.searchClear);

      if (!query || !query.trim()) {
        this._updateUI(0);
        if (clearBtn) {
          clearBtn.style.opacity = '0';
          clearBtn.style.pointerEvents = 'none';
        }
        return;
      }

      if (clearBtn) {
        clearBtn.style.opacity = '0.6';
        clearBtn.style.pointerEvents = 'auto';
      }

      // Get ALL messages, not just visible ones
      const allMessages = DOM.getAllMessageElements();
      const searchTerm = query.trim().toLowerCase();
      let results = [];

      allMessages.forEach((message) => {
        // Get the text content of the message
        let textContent = '';
        const userMarker = message.querySelector(CONFIG.selectors.userMessageMarker);
        const markdown = message.querySelector(CONFIG.selectors.markdown);

        if (userMarker) {
          textContent = userMarker.textContent || '';
        } else if (markdown) {
          textContent = markdown.textContent || '';
        } else {
          textContent = message.textContent || '';
        }

        if (!textContent.toLowerCase().includes(searchTerm)) return;

        // Find the container where we can insert highlights
        const contentEl = markdown || userMarker || message;

        // Walk through text nodes and highlight matches
        const walker = document.createTreeWalker(
          contentEl,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              if (node.textContent.toLowerCase().includes(searchTerm)) {
                return NodeFilter.FILTER_ACCEPT;
              }
              return NodeFilter.FILTER_REJECT;
            }
          }
        );

        let textNode;
        let occurrenceIndex = 0;
        while ((textNode = walker.nextNode())) {
          const text = textNode.textContent;
          const lowerText = text.toLowerCase();
          let startIndex = 0;

          while ((startIndex = lowerText.indexOf(searchTerm, startIndex)) !== -1) {
            const before = text.substring(0, startIndex);
            const match = text.substring(startIndex, startIndex + searchTerm.length);
            const after = text.substring(startIndex + searchTerm.length);

            const fragment = document.createDocumentFragment();
            if (before) {
              fragment.appendChild(document.createTextNode(before));
            }

            const highlight = document.createElement('span');
            highlight.className = 'deepblue-search-highlight';
            highlight.textContent = match;
            highlight.style.background = '#fde68a';
            highlight.style.color = '#1d1d1f';
            highlight.style.padding = '0 2px';
            highlight.style.borderRadius = '3px';
            highlight.style.fontWeight = '500';
            highlight.dataset.messageIndex = allMessages.indexOf(message);
            highlight.dataset.occurrenceIndex = occurrenceIndex;
            fragment.appendChild(highlight);

            if (after) {
              fragment.appendChild(document.createTextNode(after));
            }

            textNode.parentNode.replaceChild(fragment, textNode);

            results.push({
              element: highlight,
              message: message,
              messageIndex: allMessages.indexOf(message),
                         occurrenceIndex: occurrenceIndex
            });

            occurrenceIndex++;
            startIndex += searchTerm.length;
          }
        }
      });

      this._searchResults = results;

      if (results.length > 0) {
        this._currentIndex = 0;
        this._highlightResult(0);
      }

      this._updateUI(results.length);
      this._updateNavButtons(results.length > 0);
    },

    _clearHighlights() {
      document.querySelectorAll('.deepblue-search-highlight').forEach(el => {
        const text = el.textContent;
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(text), el);
        parent.normalize();
      });
    },

    _updateUI(resultCount) {
      const countEl = document.getElementById(CONFIG.ids.searchCount);
      if (countEl) {
        if (resultCount === 0) {
          const input = document.getElementById(CONFIG.ids.searchInput);
          if (input && input.value.trim()) {
            countEl.textContent = '0';
            countEl.style.color = '#ef4444';
          } else {
            countEl.textContent = '0';
            countEl.style.color = '#8e8e93';
          }
        } else {
          countEl.textContent = `${this._currentIndex + 1}/${resultCount}`;
          countEl.style.color = '#8e8e93';
        }
      }
    },

    _updateNavButtons(hasResults) {
      const prevBtn = document.getElementById(CONFIG.ids.searchPrev);
      const nextBtn = document.getElementById(CONFIG.ids.searchNext);

      [prevBtn, nextBtn].forEach(btn => {
        if (btn) {
          btn.style.opacity = hasResults ? '0.7' : '0.3';
          btn.style.cursor = hasResults ? 'pointer' : 'default';
        }
      });
    },

    _highlightResult(index) {
      document.querySelectorAll('.deepblue-search-highlight.active').forEach(el => {
        el.style.background = '#fde68a';
        el.style.boxShadow = 'none';
        el.style.transform = 'scale(1)';
        el.classList.remove('active');
      });

      const results = this._searchResults;
      if (index < 0 || index >= results.length) return;

      const result = results[index];
      if (result && result.element) {
        result.element.style.background = '#fbbf24';
        result.element.style.boxShadow = '0 0 0 3px #f59e0b';
        result.element.style.transform = 'scale(1.05)';
        result.element.classList.add('active');

        // Scroll to the message
        const messageEl = result.element.closest(CONFIG.selectors.messages[0]) ||
        result.element.closest(CONFIG.selectors.messages[1]);
        if (messageEl) {
          const rect = messageEl.getBoundingClientRect();
          const isVisible = (
            rect.top >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
          );

          if (!isVisible) {
            messageEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else {
            result.element.style.animation = 'deepblue-pulse 0.6s ease 2';
          }
        }
      }

      this._currentIndex = index;
      this._updateUI(results.length);
    },

    _navigate(direction) {
      if (this._searchResults.length === 0) return;

      let newIndex = this._currentIndex + direction;
      if (newIndex < 0) newIndex = this._searchResults.length - 1;
      if (newIndex >= this._searchResults.length) newIndex = 0;

      this._highlightResult(newIndex);
    },

    clear() {
      const input = document.getElementById(CONFIG.ids.searchInput);
      if (input) {
        input.value = '';
        this._performSearch('');
        input.focus();
      }
    },

    _injectStyles() {
      if (document.getElementById('deepblue-search-styles')) return;

      const style = document.createElement('style');
      style.id = 'deepblue-search-styles';
      style.textContent = `
      @keyframes deepblue-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
      `;
      document.head.appendChild(style);
    }
  };

  // ---------------------------------------------------------------------
  // PDF export
  // ---------------------------------------------------------------------

  const PdfExport = {
    _running: false,

 async run() {
   if (PdfExport._running) return;
   PdfExport._running = true;
   Toolbar.setExportButtonLoading(true);

   try {
     if (!window.jspdf?.jsPDF || typeof window.html2canvas !== 'function') {
       alert(`${BRAND_NAME} could not load its PDF engine. Try reloading the page.`);
       return;
     }

     const conversation = Extractor.extract();
     if (!conversation || conversation.messages.length === 0) {
       alert('No conversation to export. Please start a chat first.');
       return;
     }

     await PdfExport._generate(conversation);
   } catch (err) {
     console.error(`${BRAND_NAME}: export failed`, err);
     alert('Failed to export conversation. Please try again.');
   } finally {
     Toolbar.setExportButtonLoading(false);
     PdfExport._running = false;
   }
 },

 async _generate(conversation) {
   const { root, blocks } = Renderer.buildStage(conversation);
   document.body.appendChild(root);

   try {
     await nextFrame();

     const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
     const { pageWidthPt, pageHeightPt, marginPt, renderScale, jpegQuality, blockSpacingPt } = CONFIG.pdf;
     const contentWidthPt = pageWidthPt - marginPt * 2;
     const pageContentHeightPt = pageHeightPt - marginPt * 2;

     let cursorY = marginPt;

     for (const blockEl of blocks) {
       const canvas = await html2canvas(blockEl, {
         scale: renderScale,
         backgroundColor: '#ffffff',
         useCORS: true,
         logging: false,
       });
       if (!canvas.width || !canvas.height) continue;

       const ratio = contentWidthPt / canvas.width;
       const blockHeightPt = canvas.height * ratio;

       if (blockHeightPt <= pageContentHeightPt) {
         if (cursorY + blockHeightPt > marginPt + pageContentHeightPt) {
           pdf.addPage();
           cursorY = marginPt;
         }
         pdf.addImage(canvas.toDataURL('image/jpeg', jpegQuality), 'JPEG', marginPt, cursorY, contentWidthPt, blockHeightPt);
         cursorY += blockHeightPt + blockSpacingPt;
       } else {
         cursorY = PdfExport._addSlicedBlock(pdf, canvas, ratio, cursorY, contentWidthPt, pageContentHeightPt, marginPt, jpegQuality, blockSpacingPt);
       }
     }

     pdf.save(sanitizeFilename(conversation.title) + '.pdf');
   } finally {
     root.remove();
   }
 },

 _addSlicedBlock(pdf, canvas, ratio, cursorY, contentWidthPt, pageContentHeightPt, marginPt, jpegQuality, blockSpacingPt) {
   const pxPerPage = pageContentHeightPt / ratio;
   let sy = 0;
   let first = true;

   while (sy < canvas.height) {
     const sliceHeightPx = Math.min(pxPerPage, canvas.height - sy);
     const sliceCanvas = document.createElement('canvas');
     sliceCanvas.width = canvas.width;
     sliceCanvas.height = sliceHeightPx;
     const ctx = sliceCanvas.getContext('2d');
     ctx.fillStyle = '#ffffff';
     ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
     ctx.drawImage(canvas, 0, sy, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

     const sliceHeightPt = sliceHeightPx * ratio;
     if (!first || cursorY + sliceHeightPt > marginPt + pageContentHeightPt) {
       pdf.addPage();
       cursorY = marginPt;
     }
     pdf.addImage(sliceCanvas.toDataURL('image/jpeg', jpegQuality), 'JPEG', marginPt, cursorY, contentWidthPt, sliceHeightPt);
     cursorY += sliceHeightPt + blockSpacingPt;
     sy += sliceHeightPx;
     first = false;
   }
   return cursorY;
 },
  };

  // ---------------------------------------------------------------------
  // Conversation extraction
  // ---------------------------------------------------------------------

  const Extractor = {
    extract() {
      const title = DOM.findConversationTitle();
      const containers = DOM.findMessages();
      if (!containers.length) return { title, messages: [] };

      const messages = [];
      containers.forEach((container) => {
        const isUser =
        container.classList.contains('d29f3d7d') || container.querySelector(CONFIG.selectors.userMessageMarker) !== null;

        let content = '';
        if (isUser) {
          content = container.querySelector(CONFIG.selectors.userMessageMarker)?.textContent?.trim() || '';
        } else {
          const markdown = container.querySelector(CONFIG.selectors.markdown);
          if (markdown) content = this._renderNodeChildren(markdown);
        }

        if (content) messages.push({ role: isUser ? 'user' : 'assistant', content, isHTML: !isUser });
      });

      return { title, messages };
    },

 _renderNodeChildren(el) {
   let html = '';
   for (const child of el.children) html += this._renderNode(child);
   return html;
 },

 _renderNode(node) {
   const tag = node.tagName?.toLowerCase();

   switch (tag) {
     case 'p':
     case 'h1':
     case 'h2':
     case 'h3':
     case 'h4':
     case 'strong':
     case 'b':
     case 'em':
     case 'i':
     case 'span':
       return `<${tag}>${node.innerHTML}</${tag}>`;

     case 'br':
       return '<br>';
     case 'hr':
       return '<hr>';

     case 'a': {
       const href = node.getAttribute('href') || '';
       return `<a href="${escapeHtml(href)}">${node.innerHTML}</a>`;
     }

     case 'blockquote':
       return `<blockquote>${this._renderNodeChildren(node)}</blockquote>`;

     case 'ul':
     case 'ol': {
       let inner = '';
       node.querySelectorAll(':scope > li').forEach((li) => {
         inner += `<li>${li.innerHTML}</li>`;
       });
       return `<${tag}>${inner}</${tag}>`;
     }

     case 'table': {
       let rows = '';
       node.querySelectorAll('tr').forEach((tr) => {
         let cells = '';
         tr.querySelectorAll('th, td').forEach((cell) => {
           const cellTag = cell.tagName.toLowerCase();
           cells += `<${cellTag}>${cell.innerHTML}</${cellTag}>`;
         });
         rows += `<tr>${cells}</tr>`;
       });
       return `<table>${rows}</table>`;
     }

     case 'pre': {
       const codeEl = node.querySelector('code');
       const codeText = (codeEl || node).textContent;
       const language = codeEl?.className?.replace('language-', '').trim();
       return (
         `<div class="code-block">` +
         (language ? `<div class="code-header">${escapeHtml(language)}</div>` : '') +
         `<pre><code>${escapeHtml(codeText)}</code></pre></div>`
       );
     }

     case 'code':
       return `<code class="inline-code">${escapeHtml(node.textContent)}</code>`;

     case 'img':
       return '';

     case 'div':
       if (node.className?.includes('ds-markdown')) return this._renderNodeChildren(node);
     default:
       if (node.children?.length) {
         let out = '';
         for (const child of node.children) out += this._renderNode(child);
         return out;
       }
       return node.textContent ? escapeHtml(node.textContent) : '';
   }
 },
  };

  // ---------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------

  const Renderer = {
    buildStage(conversation) {
      const root = document.createElement('div');
      root.id = CONFIG.ids.renderStage;
      root.style.cssText = `
      position: fixed;
      top: 0;
      left: -100000px;
      width: ${CONFIG.pdf.contentWidthPx}px;
      background: #ffffff;
      z-index: -1;
      `;

      const style = document.createElement('style');
      style.textContent = this._css();
      root.appendChild(style);

      const blocks = [];
      const timestamp = new Date().toLocaleString();

      const header = document.createElement('div');
      header.className = 'db-header';
      header.innerHTML = `
      <div class="db-logo">${escapeHtml(BRAND_NAME)}</div>
      <h1 class="db-title">${escapeHtml(conversation.title)}</h1>
      <div class="db-subtitle">Exported on ${escapeHtml(timestamp)} - ${conversation.messages.length} messages</div>
      `;
      root.appendChild(header);
      blocks.push(header);

      conversation.messages.forEach((msg) => {
        const el = document.createElement('div');
        el.className = `db-message db-${msg.role}`;
        const body = msg.isHTML ? msg.content : `<p>${escapeHtml(msg.content).replace(/\n/g, '<br>')}</p>`;
        el.innerHTML = `
        <div class="db-role-label"><span class="db-dot"></span>${msg.role === 'user' ? 'You' : 'DeepSeek'}</div>
        <div class="db-content">${body}</div>
        `;
        root.appendChild(el);
        blocks.push(el);
      });

      const footer = document.createElement('div');
      footer.className = 'db-footer';
      footer.innerHTML = `<span>Exported with <span class="db-brand">${escapeHtml(BRAND_NAME)}</span></span> - <span>${new Date().getFullYear()}</span>`;
      root.appendChild(footer);
      blocks.push(footer);

      return { root, blocks };
    },

 _css() {
   return `
   #${CONFIG.ids.renderStage}, #${CONFIG.ids.renderStage} * {
   box-sizing: border-box;
   font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
   color: #1d1d1f;
   }
   #${CONFIG.ids.renderStage} .db-header { text-align: center; padding: 20px 24px 16px; border-bottom: 3px solid #3964fe; margin-bottom: 16px; }
   #${CONFIG.ids.renderStage} .db-logo { font-size: 26px; font-weight: 700; color: #3964fe; letter-spacing: -0.5px; }
   #${CONFIG.ids.renderStage} .db-title { font-size: 17px; font-weight: 500; margin: 6px 0 3px; word-break: break-word; }
   #${CONFIG.ids.renderStage} .db-subtitle { font-size: 12px; color: #8e8e93; }

   #${CONFIG.ids.renderStage} .db-message { margin: 0 4px 14px; padding: 14px 20px; border-radius: 10px; border: 1px solid #e9ecf0; }
   #${CONFIG.ids.renderStage} .db-message.db-user { background: #f0f7ff; border-color: #d0e0ff; border-left: 4px solid #3964fe; }
   #${CONFIG.ids.renderStage} .db-message.db-assistant { background: #f8f9fb; border-color: #e9ecf0; border-right: 4px solid #6c5ce7; }
   #${CONFIG.ids.renderStage} .db-role-label { font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
   #${CONFIG.ids.renderStage} .db-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: currentColor; }
   #${CONFIG.ids.renderStage} .db-user .db-dot { background: #3964fe; }
   #${CONFIG.ids.renderStage} .db-assistant .db-dot { background: #6c5ce7; }

   #${CONFIG.ids.renderStage} .db-content { font-size: 14px; line-height: 1.6; word-wrap: break-word; }
   #${CONFIG.ids.renderStage} .db-content p { margin: 0 0 8px; }
   #${CONFIG.ids.renderStage} .db-content p:last-child { margin-bottom: 0; }
   #${CONFIG.ids.renderStage} .db-content ul, #${CONFIG.ids.renderStage} .db-content ol { padding-left: 22px; margin: 6px 0; }
   #${CONFIG.ids.renderStage} .db-content li { margin-bottom: 4px; }
   #${CONFIG.ids.renderStage} .db-content strong { font-weight: 600; }
   #${CONFIG.ids.renderStage} .db-content em { font-style: italic; }
   #${CONFIG.ids.renderStage} .db-content a { color: #3964fe; text-decoration: underline; word-break: break-all; }
   #${CONFIG.ids.renderStage} .db-content blockquote { margin: 8px 0; padding: 4px 14px; border-left: 3px solid #d0d5dd; color: #4b5563; }
   #${CONFIG.ids.renderStage} .db-content h1, #${CONFIG.ids.renderStage} .db-content h2, #${CONFIG.ids.renderStage} .db-content h3 { margin: 10px 0 6px; font-weight: 600; }
   #${CONFIG.ids.renderStage} .db-content h1 { font-size: 19px; }
   #${CONFIG.ids.renderStage} .db-content h2 { font-size: 17px; }
   #${CONFIG.ids.renderStage} .db-content h3 { font-size: 15px; }
   #${CONFIG.ids.renderStage} .db-content table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
   #${CONFIG.ids.renderStage} .db-content th, #${CONFIG.ids.renderStage} .db-content td { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; }
   #${CONFIG.ids.renderStage} .db-content th { background: #f3f4f6; font-weight: 600; }

   #${CONFIG.ids.renderStage} .code-block { background: #1e1e2e; border-radius: 8px; margin: 10px 0; overflow: hidden; }
   #${CONFIG.ids.renderStage} .code-header { background: #2d2d44; color: #cdd6f4; font-size: 11px; font-weight: 500; padding: 4px 14px; font-family: 'Menlo', 'Consolas', monospace; border-bottom: 1px solid #3d3d55; }
   #${CONFIG.ids.renderStage} .code-block pre { margin: 0; padding: 12px 16px; white-space: pre-wrap; word-wrap: break-word; background: #1e1e2e; }
   #${CONFIG.ids.renderStage} .code-block code { font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; line-height: 1.5; color: #cdd6f4; white-space: pre-wrap; word-wrap: break-word; }
   #${CONFIG.ids.renderStage} .inline-code { background: #f0f0f5; padding: 1px 6px; border-radius: 3px; font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; color: #d63384; border: 1px solid #e5e5ea; }

   #${CONFIG.ids.renderStage} .db-footer { text-align: center; padding: 14px 0 6px; margin-top: 6px; border-top: 2px solid #e9ecf0; font-size: 11px; color: #8e8e93; }
   #${CONFIG.ids.renderStage} .db-brand { color: #3964fe; font-weight: 500; }
   `;
 },
  };

  // ---------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------

  function isOwnMutation(mutations) {
    return mutations.every((m) => {
      const node = m.target;
      return (
        node?.id?.startsWith?.('deepblue-') ||
        node?.closest?.(`#${CONFIG.ids.renderStage}`) ||
        node?.closest?.(`#${CONFIG.ids.contextMeter}`) ||
        node?.closest?.(`#${CONFIG.ids.searchBar}`) ||
        node?.classList?.contains?.('deepblue-token-counter') ||
        node?.classList?.contains?.('deepblue-search-highlight')
      );
    });
  }

  function runScan() {
    Toolbar.ensureInjected();
    TokenCounter.scan();
    ContextMeter.scan();
    ChatSearch.ensureInjected();
    ChatSearch._injectStyles();
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
})();
