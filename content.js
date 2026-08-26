// content.js - DeepBlue: Export DeepSeek Conversation as PDF (direct save, no print dialog)
//
// Structure:
//   CONFIG        - all selectors / tunables in one place, with fallback chains
//   DOM           - element lookups (memoized where safe, always re-verified)
//   CharCounter   - live character count of the composer textarea
//   TokenCounter  - per-message estimated token badges
//   PdfExport     - conversation extraction + off-screen render + jsPDF assembly
//   Bootstrap     - single MutationObserver that drives everything, with a guard
//                   against reacting to DeepBlue's own DOM writes

(function () {
  'use strict';

  const BRAND_NAME = 'DeepBlue';

  const CONFIG = {
    ids: {
      exportBtn: 'deepblue-export-pdf-btn',
      counter: 'deepblue-char-counter',
      countSpan: 'deepblue-char-count',
      renderStage: 'deepblue-pdf-render-stage',
    },
    selectors: {
      fileInput: 'input[type="file"][multiple], input[type="file"]',
      // Ordered fallback chain: prefer the stable-ish hashed class, fall back to
      // placeholder text, fall back to "any textarea inside the composer form".
      textarea: [
        'textarea._27c9245',
        'textarea[placeholder*="Message DeepSeek"]',
        'textarea[placeholder*="Send a message"]',
      ],
      messages: ['.ds-message._63c77b1', '[class*="ds-message"]'],
      userMessageMarker: '.fbb737a4',
      markdown: '.ds-markdown',
      title: ['.afa34042', '.d00ed9c9'],
      messageActionRow: ['.ds-flex._0a3d93b', '._0a3d93b'],
      messageButtonRow: ['.ds-flex._965abe9'],
      shareButton: '.ds-button[title*="Share" i]',
      primaryCircleButton: '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle',
      fitContentWrapper: 'div[style*="width: fit-content"]',
    },
    charCounter: {
      warnAt: 500,
      dangerAt: 1000,
      colors: { normal: '#8e8e93', warn: '#feca57', danger: '#ff6b6b' },
    },
    tokenCounter: {
      // Heuristic constants for the estimator - see estimateTokens() below.
      latinCharsPerToken: 4,
      cjkCharsPerToken: 1.6,
    },
    timing: {
      initialScanDelayMs: 1200,
      observerDebounceMs: 300,
      postClickRecheckDelaysMs: [0, 120, 350],
    },
    pdf: {
      pageWidthPt: 595.28, // A4
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

  /** Try each selector in order, return the first match or null. */
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
    /** The wrapper around the round primary "send" button (used as our PDF-button anchor). */
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

        // Desired final order:  [counter]  clip  ...other toolbar buttons...  [PDF]  send
        //  - counter goes at the very front of the toolbar (left of everything, including the clip).
        //  - PDF button goes immediately before the send-button wrapper (right of the clip, next to send).
        if (!document.getElementById(CONFIG.ids.exportBtn)) {
          toolbar.insertBefore(exportBtn, sendWrapper);
        }
        if (!document.getElementById(CONFIG.ids.counter)) {
          toolbar.insertBefore(counter, toolbar.firstChild);
        }
        // Belt-and-braces: if the toolbar turns out to be a flex/grid container,
        // explicit `order` guarantees the visual position even if some future
        // DOM change reorders siblings underneath us.
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

      // React/virtual-DOM apps often clear the textarea programmatically after
      // send, without firing an `input` event. Re-check a few times shortly
      // after any click on a primary circular button that ISN'T our own export
      // button (i.e. the actual send button).
      document.addEventListener('click', (e) => {
        const target = e.target.closest?.(CONFIG.selectors.primaryCircleButton);
        if (!target || target.id === CONFIG.ids.exportBtn) return;
        for (const delay of CONFIG.timing.postClickRecheckDelaysMs) {
          setTimeout(() => CharCounter.update(DOM.findTextarea()), delay);
        }
      });

      this._charWireDone = true;
    },
  };

  // ---------------------------------------------------------------------
  // Character counter (composer textarea)
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
  // Per-message estimated token counter
  // ---------------------------------------------------------------------

  const TokenCounter = {
    _processed: new WeakSet(),

    /**
     * Rough token estimate that's aware of CJK text, since "chars / 4" is a
     * reasonable approximation for English/Latin text but badly undercounts
     * for Chinese/Japanese/Korean, where each character is closer to its own
     * token. We split the text into CJK vs. non-CJK spans and estimate each
     * separately, which keeps the common case cheap and fixes the worst
     * failure mode of the naive approach.
     */
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

      const tokenCount = this.estimate(markdown.textContent);

      const actionRow = queryFirst(CONFIG.selectors.messageActionRow, message.parentElement || document);
      const buttonRow = actionRow ? queryFirst(CONFIG.selectors.messageButtonRow, actionRow) : null;
      if (!buttonRow) return;

      buttonRow.insertBefore(this._buildBadge(tokenCount), this._findInsertAnchor(buttonRow));
      this._processed.add(message);
    },

    _findInsertAnchor(buttonRow) {
      return buttonRow.querySelector(CONFIG.selectors.shareButton) || buttonRow.lastElementChild || null;
    },

    _buildBadge(tokenCount) {
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
      badge.title = `Estimated tokens: ${tokenCount}`;
      badge.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.6;">
          <path d="M8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0ZM8 14C4.69 14 2 11.31 2 8C2 4.69 4.69 2 8 2C11.31 2 14 4.69 14 8C14 11.31 11.31 14 8 14Z" fill="currentColor"/>
          <path d="M8 4C7.45 4 7 4.45 7 5V8.5L9.2 10.7C9.6 11.1 10.2 11.1 10.6 10.7C11 10.3 11 9.7 10.6 9.3L9 7.7V5C9 4.45 8.55 4 8 4Z" fill="currentColor"/>
        </svg>
        <span>${tokenCount}</span>
        <span style="font-weight: 400; font-size: 10px; opacity: 0.7;">tokens</span>
      `;
      return badge;
    },
  };

  // ---------------------------------------------------------------------
  // PDF export
  // ---------------------------------------------------------------------

  const PdfExport = {
    _running: false,

    async run() {
      if (PdfExport._running) return; // guard against double-clicks / rapid re-entry
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
        await nextFrame(); // let layout settle before snapshotting

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
          if (!canvas.width || !canvas.height) continue; // skip empty/failed blocks

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

    /** Blocks taller than one page (e.g. a huge code block) get sliced at page boundaries. */
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
  // Conversation extraction (reads the live DeepSeek DOM into plain data)
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
          return ''; // images from the live chat aren't reliably fetchable off-thread; skip rather than break layout

        case 'div':
          if (node.className?.includes('ds-markdown')) return this._renderNodeChildren(node);
        // fall through intentionally for generic divs
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
  // Off-screen render stage used to snapshot the PDF content
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
  // Bootstrap: one debounced MutationObserver drives both features, and
  // ignores mutations that originate from DeepBlue's own injected nodes so
  // we don't churn on our own DOM writes.
  // ---------------------------------------------------------------------

  function isOwnMutation(mutations) {
    return mutations.every((m) => {
      const node = m.target;
      return (
        node?.id?.startsWith?.('deepblue-') ||
        node?.closest?.(`#${CONFIG.ids.renderStage}`) ||
        node?.classList?.contains?.('deepblue-token-counter')
      );
    });
  }

  function runScan() {
    Toolbar.ensureInjected();
    TokenCounter.scan();
  }

  const debouncedScan = debounce(runScan, CONFIG.timing.observerDebounceMs);

  const observer = new MutationObserver((mutations) => {
    if (isOwnMutation(mutations)) return;
    debouncedScan();
  });

  function start() {
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
