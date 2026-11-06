// features/diagram-handoff.js - adds a "turn this reply into a diagram"
// button to each assistant response's action row, right after the
// "download this response" button added by message-pdf-export.js.
//
// Clicking it opens VamimiAI (CONFIG.diagram.appUrl) in a new tab next to
// this one, with the reply - and the question that prompted it - already
// in VamimiAI's message box. Nothing is sent anywhere until the person
// presses Send over there.
//
// HOW THE TEXT TRAVELS
//   The text rides in the URL *fragment* (after "#"), which browsers never
//   send to any server, so there is no server size limit and the reply
//   never appears in a log. It is compressed first:
//     #prefill=z.<base64url(deflate-raw(UTF-8 text))>
//   (VamimiAI decodes it in frontend/static/js/core/prefill.js; keep the
//   two in step.) Text compresses 3-4x, and Chrome accepts URLs up to
//   2 MB, so even very long replies go across whole. Only a reply that
//   would still be too long after compression is cut, at a paragraph
//   break, with a visible note saying so.
//   If CompressionStream is ever missing, the plain form "t.<uri-encoded>"
//   is used instead (VamimiAI reads both).
//
// The tab is opened by background.js (chrome.tabs.create - no extra
// permission needed), not window.open, because compressing a long reply
// is async and would lose the click's user activation, and window.open is
// then blocked as a popup. background.js only opens URLs on
// CONFIG.diagram.appUrl's origin.
//
// Depends on: config.js, dom.js, utils.js (queryFirst, htmlNodeToPlainText),
// i18n.js (Lang). Must be loaded AFTER message-pdf-export.js in
// manifest.json's content_scripts[].js array (its button anchors off
// .deepblue-msg-download-btn).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const DiagramHandoff = {
  _processed: new WeakSet(),

  scan(messages) {
    try {
      const list = Array.from(messages || DOM.findMessages());
      list.forEach((message) => this._processMessage(message));
    } catch (err) {
      console.debug(`${BRAND_NAME}: diagram handoff error`, err);
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
    if (!this._isAssistantMessage(message)) return;

    const markdown = message.querySelector(CONFIG.selectors.markdown);
    if (!markdown) return;

    const actionRow = queryFirst(
      CONFIG.selectors.messageActionRow,
      message.parentElement || document
    );
    const buttonRow = actionRow ? queryFirst(CONFIG.selectors.messageButtonRow, actionRow) : null;
    if (!buttonRow) return;
    if (buttonRow.querySelector('.deepblue-diagram-btn')) {
      this._processed.add(message);
      return;
    }

    // Right after "download this response"; else after "copy without
    // markdown"; else before DeepSeek's Share button, like copy-plain.js.
    const after =
      buttonRow.querySelector('.deepblue-msg-download-btn') ||
      buttonRow.querySelector('.deepblue-copy-plain-btn');
    const anchor = after
      ? after.nextSibling
      : buttonRow.querySelector(CONFIG.selectors.shareButton) || buttonRow.lastElementChild || null;

    buttonRow.insertBefore(this._buildButton(message), anchor);
    this._processed.add(message);
  },

  _buildButton(assistantMessage) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deepblue-diagram-btn';
    btn.dataset.dbTip = Lang.t('diagram.title');
    btn.setAttribute('aria-label', Lang.t('diagram.title'));
    btn.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 50%; border: none; background: none;
    color: var(--db-text-secondary); cursor: pointer; padding: 0; margin-left: 2px; flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
    `;
    btn.innerHTML = this._icon();

    btn.addEventListener('mouseenter', () => {
      if (btn.disabled) return;
      btn.style.background = 'var(--db-surface-hover)';
      btn.style.color = 'var(--db-text)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
      btn.style.color = 'var(--db-text-secondary)';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._open(assistantMessage, btn);
    });

    return btn;
  },

  // The question this reply answers: the nearest user turn above it.
  _questionFor(assistantMessage) {
    const live = Array.from(DOM.findMessages());
    const index = live.indexOf(assistantMessage);
    for (let i = (index === -1 ? live.length : index) - 1; i >= 0; i--) {
      if (!this._isAssistantMessage(live[i])) {
        return live[i].querySelector(CONFIG.selectors.userMessageMarker)?.textContent?.trim() || '';
      }
    }
    return '';
  },

  // What lands in VamimiAI's message box. The instruction is in the
  // person's DeepBlue language, so VamimiAI answers in it too.
  buildRequest(question, answer) {
    const max = CONFIG.diagram.maxQuestionChars;
    const q = question.length > max ? question.slice(0, max).trimEnd() + '…' : question;
    const parts = [Lang.t('diagram.prompt')];
    if (q) parts.push(`${Lang.t('diagram.question')}\n${q}`);
    parts.push(`${Lang.t('diagram.answer')}\n${answer}`);
    return parts.join('\n\n');
  },

  async _encode(text) {
    if (typeof CompressionStream === 'undefined') return 't.' + encodeURIComponent(text);
    const stream = new Blob([new TextEncoder().encode(text)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return 'z.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  _baseUrl() {
    const url = new URL(CONFIG.diagram.appUrl);
    Object.entries(CONFIG.diagram.utm).forEach(([k, v]) => url.searchParams.set(`utm_${k}`, v));
    return url.toString();
  },

  // Full URL for this question + answer. Cuts the answer (at a paragraph
  // break where possible, with a visible note) only when even the
  // compressed URL would pass CONFIG.diagram.maxUrlChars.
  async buildUrl(question, answer) {
    const base = this._baseUrl() + '#prefill=';
    let body = answer;
    for (let attempt = 0; attempt < 8; attempt++) {
      const url = base + (await this._encode(this.buildRequest(question, body)));
      if (url.length <= CONFIG.diagram.maxUrlChars) return url;
      let cut = Math.floor(body.length * (CONFIG.diagram.maxUrlChars / url.length) * 0.9);
      const para = body.lastIndexOf('\n\n', cut);
      if (para > cut * 0.8) cut = para;
      body = body.slice(0, cut).trimEnd() + '\n\n' + Lang.t('diagram.trimmed');
    }
    return null;
  },

  async _open(assistantMessage, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.style.cursor = 'default';
    btn.innerHTML = this._spinIcon();
    let ok = false;
    try {
      const markdown = assistantMessage.querySelector(CONFIG.selectors.markdown);
      const answer = markdown ? htmlNodeToPlainText(markdown) : '';
      if (answer) {
        const url = await this.buildUrl(this._questionFor(assistantMessage), answer);
        if (url) {
          const res = await chrome.runtime.sendMessage({ type: 'deepblue:open-diagram', url });
          ok = !!res?.ok;
        }
      }
    } catch (err) {
      console.error(`${BRAND_NAME}: diagram handoff failed`, err);
    }
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.innerHTML = ok ? this._checkIcon() : this._icon();
    btn.dataset.dbTip = ok ? Lang.t('diagram.opened') : Lang.t('diagram.failed');
    setTimeout(() => {
      btn.innerHTML = this._icon();
      btn.dataset.dbTip = Lang.t('diagram.title');
    }, 1600);
  },

  // Three linked boxes: a small flow diagram.
  _icon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.5" y="3" width="7" height="6" rx="1.6" stroke="currentColor" stroke-width="1.6"/>
    <rect x="2.5" y="15" width="7" height="6" rx="1.6" stroke="currentColor" stroke-width="1.6"/>
    <rect x="15" y="15" width="6.5" height="6" rx="1.6" stroke="currentColor" stroke-width="1.6"/>
    <path d="M6 9v6M9.5 18H15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    `;
  },

  _spinIcon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" stroke-opacity="0.25"/>
    <path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite"/>
    </path>
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
