// features/diagram-handoff.js - adds a "Diagram" button to each assistant
// response's action row, right after the "download this response" button
// added by message-pdf-export.js.
//
// Clicking it opens VamimiAI (CONFIG.diagram.appUrl) in a new tab next to
// this one, with the reply - and the question that prompted it - already
// in VamimiAI's message box. Nothing is sent anywhere until the person
// presses Send over there.
//
// WHICH REPLIES GET IT
//   Only replies with something to draw: a list, table, heading or code
//   block, or at least CONFIG.diagram.minChars of text. "Hey! What's on
//   your mind?" gets no button. A reply still streaming in is checked again
//   on every scan, so the button appears once it qualifies.
//
// BEING FOUND (the spotlight)
//   It is a labelled pill, not a bare grey icon. For the first replies
//   after install or the 1.5 update (background.js arms SPOTLIGHT_KEY) the
//   newest button in view glows, shakes twice and gets a pointer bubble.
//   The announcement's "Show me the button" (whats-new.js -> spotlightNow)
//   scrolls to it, or - in a chat with no reply yet - says to ask
//   something first and spotlights the first reply that qualifies. It ends
//   for good when the button is used, the bubble is dismissed, or it has
//   been shown on CONFIG.diagram.spotlightPages pages.
//
// HOW THE TEXT TRAVELS
//   The text rides in the URL *fragment* (after "#"), which browsers never
//   send to any server, so there is no server size limit and the reply
//   never appears in a log. It is compressed first:
//     #prefill=z.<base64url(deflate-raw(UTF-8 text))>
//   (VamimiAI decodes it in frontend/static/js/core/prefill.js; keep the
//   two in step.) Chrome accepts URLs up to 2 MB - about 3M characters of
//   real text after compression - so whole replies go across. Only a reply
//   still too long after compression is cut, at a paragraph break, with a
//   visible note saying so. If CompressionStream is ever missing, the plain
//   form "t.<uri-encoded>" is used instead (VamimiAI reads both).
//
// The tab is opened by background.js (chrome.tabs.create - no extra
// permission needed), not window.open, because compressing a long reply
// is async and would lose the click's user activation, and window.open is
// then blocked as a popup. background.js only opens URLs on
// CONFIG.diagram.appUrl's origin.
//
// Styles: .deepblue-diagram-* in src/theme.css.
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
  _SPOTLIGHT_KEY: 'deepblue-diagram-spotlight-v1',
  _spot: null, // { armed, pages } once loaded
  _spotLoading: null,
  _spotlitThisPage: false,
  _forceNext: false, // "Show me" in a chat with no button yet
  _coach: null,

  scan(messages) {
    try {
      const list = Array.from(messages || DOM.findMessages());
      list.forEach((message) => this._processMessage(message));
      this._maybeSpotlight();
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

  // Something worth drawing: structure, or enough text.
  _worthDiagram(markdown) {
    if (markdown.querySelector('li, table, h1, h2, h3, h4, pre')) return true;
    return (markdown.textContent || '').trim().length >= CONFIG.diagram.minChars;
  },

  _processMessage(message) {
    if (this._processed.has(message)) return;
    if (!this._isAssistantMessage(message)) return;

    const markdown = message.querySelector(CONFIG.selectors.markdown);
    if (!markdown || !this._worthDiagram(markdown)) return; // re-checked next scan

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
    btn.innerHTML = this._content(this._icon());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._endSpotlight();
      this._open(assistantMessage, btn);
    });
    return btn;
  },

  _content(iconSvg) {
    return `${iconSvg}<span>${escapeHtml(Lang.t('diagram.label'))}</span>`;
  },

  // ---- spotlight ---------------------------------------------------------

  async _loadSpot() {
    if (this._spot) return this._spot;
    if (!this._spotLoading) {
      this._spotLoading = chrome.storage.local
        .get(this._SPOTLIGHT_KEY)
        .then((res) => (this._spot = res[this._SPOTLIGHT_KEY] || { armed: false, pages: 0 }))
        .catch(() => (this._spot = { armed: false, pages: 0 }));
    }
    return this._spotLoading;
  },

  _saveSpot() {
    try {
      chrome.storage.local.set({ [this._SPOTLIGHT_KEY]: this._spot });
    } catch (err) {
      /* extension reloaded */
    }
  },

  // The newest button that is actually on screen.
  _visibleButton() {
    const all = Array.from(document.querySelectorAll('.deepblue-diagram-btn'));
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i].getBoundingClientRect();
      if (r.width && r.top >= 0 && r.bottom <= window.innerHeight) return all[i];
    }
    return null;
  },

  async _maybeSpotlight() {
    if (this._spotlitThisPage && !this._forceNext) return;
    const spot = await this._loadSpot();
    if (!spot.armed && !this._forceNext) return;
    if (document.visibilityState !== 'visible') return;
    const btn = this._visibleButton();
    if (!btn) return;
    this._forceNext = false;
    this._hideHint();
    this._spotlight(btn);
  },

  // Called by the announcement's "Show me the button".
  async spotlightNow() {
    const all = Array.from(document.querySelectorAll('.deepblue-diagram-btn'));
    const btn = all[all.length - 1];
    if (btn) {
      btn.scrollIntoView({ block: 'center', behavior: UiKit.reducedMotion?.() ? 'auto' : 'smooth' });
      setTimeout(() => this._spotlight(btn), 450);
      return;
    }
    this._forceNext = true;
    this._showHint();
  },

  _spotlight(btn) {
    document.querySelectorAll('.deepblue-diagram-btn.is-spotlit').forEach((b) => b !== btn && b.classList.remove('is-spotlit'));
    btn.classList.remove('is-spotlit');
    void btn.offsetWidth; // restart the animation if it ran before
    btn.classList.add('is-spotlit');
    this._showCoach(btn);
    if (!this._spotlitThisPage && this._spot?.armed) {
      this._spot.pages = (this._spot.pages || 0) + 1;
      if (this._spot.pages >= CONFIG.diagram.spotlightPages) this._spot.armed = false;
      this._saveSpot();
    }
    this._spotlitThisPage = true;
  },

  _endSpotlight() {
    this._forceNext = false;
    this._hideHint();
    this._hideCoach();
    document.querySelectorAll('.deepblue-diagram-btn.is-spotlit').forEach((b) => b.classList.remove('is-spotlit'));
    this._loadSpot().then((spot) => {
      if (!spot.armed) return;
      spot.armed = false;
      this._saveSpot();
    });
  },

  _showCoach(btn) {
    this._hideCoach();
    const el = document.createElement('div');
    el.className = 'deepblue-diagram-coach';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${escapeHtml(Lang.t('diagram.coach'))}</span><button type="button" aria-label="${escapeHtml(Lang.t('review.close'))}">✕</button>`;
    el.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      this._endSpotlight();
    });
    document.body.appendChild(el);

    const place = () => {
      if (!btn.isConnected) return this._hideCoach();
      const r = btn.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      const below = r.top - h - 12 < 8;
      el.classList.toggle('below', below);
      el.style.left = `${left}px`;
      el.style.top = `${below ? r.bottom + 12 : r.top - h - 12}px`;
      el.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`);
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const timer = setTimeout(() => this._hideCoach(), CONFIG.diagram.coachMs);
    this._coach = { el, place, timer };
  },

  _hideCoach() {
    const c = this._coach;
    if (!c) return;
    this._coach = null;
    clearTimeout(c.timer);
    window.removeEventListener('scroll', c.place, true);
    window.removeEventListener('resize', c.place);
    c.el.classList.add('out');
    setTimeout(() => c.el.remove(), 220);
  },

  _showHint() {
    this._hideHint();
    const el = document.createElement('div');
    el.className = 'deepblue-diagram-hint';
    el.id = 'deepblue-diagram-hint';
    el.setAttribute('role', 'status');
    el.innerHTML = escapeHtml(Lang.t('diagram.hint')).replace(
      '{label}',
      `<b>${escapeHtml(Lang.t('diagram.label'))}</b>`
    );
    document.body.appendChild(el);
    this._hintTimer = setTimeout(() => this._hideHint(), CONFIG.diagram.hintMs);
  },

  _hideHint() {
    clearTimeout(this._hintTimer);
    const el = document.getElementById('deepblue-diagram-hint');
    if (!el) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  },

  // ---- the handoff -------------------------------------------------------

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

  // The app's address with the visit labelled; `campaign` overrides
  // CONFIG.diagram.utm.campaign (the announcement's own link uses one).
  appUrl(campaign) {
    const url = new URL(CONFIG.diagram.appUrl);
    const utm = { ...CONFIG.diagram.utm, ...(campaign ? { campaign } : {}) };
    Object.entries(utm).forEach(([k, v]) => url.searchParams.set(`utm_${k}`, v));
    return url.toString();
  },

  // Opens a VamimiAI URL in a new tab next to this one (background.js).
  async openTab(url) {
    const res = await chrome.runtime.sendMessage({ type: 'deepblue:open-diagram', url });
    return !!res?.ok;
  },

  // Full URL for this question + answer. Cuts the answer (at a paragraph
  // break where possible, with a visible note) only when even the
  // compressed URL would pass CONFIG.diagram.maxUrlChars.
  async buildUrl(question, answer) {
    const base = this.appUrl() + '#prefill=';
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
    btn.innerHTML = this._content(this._spinIcon());
    let ok = false;
    try {
      const markdown = assistantMessage.querySelector(CONFIG.selectors.markdown);
      const answer = markdown ? htmlNodeToPlainText(markdown) : '';
      if (answer) {
        const url = await this.buildUrl(this._questionFor(assistantMessage), answer);
        if (url) ok = await this.openTab(url);
      }
    } catch (err) {
      console.error(`${BRAND_NAME}: diagram handoff failed`, err);
    }
    btn.disabled = false;
    btn.innerHTML = this._content(ok ? this._checkIcon() : this._icon());
    btn.dataset.dbTip = ok ? Lang.t('diagram.opened') : Lang.t('diagram.failed');
    setTimeout(() => {
      btn.innerHTML = this._content(this._icon());
      btn.dataset.dbTip = Lang.t('diagram.title');
    }, 1600);
  },

  // Three linked boxes: a small flow diagram.
  _icon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="2.5" y="3" width="7" height="6" rx="1.6" stroke="currentColor" stroke-width="1.8"/>
    <rect x="2.5" y="15" width="7" height="6" rx="1.6" stroke="currentColor" stroke-width="1.8"/>
    <rect x="15" y="15" width="6.5" height="6" rx="1.6" stroke="currentColor" stroke-width="1.8"/>
    <path d="M6 9v6M9.5 18H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  },

  _spinIcon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" stroke-opacity="0.25"/>
    <path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite"/>
    </path>
    </svg>`;
  },

  _checkIcon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M5 13l4 4L19 7" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },
};
