// features/bookmarks.js - bookmark any message in the current chat, and
// jump back to it later through a fixed icon pinned to the corner of the
// screen.
//
// DeepSeek doesn't expose a stable message id in the DOM, so a message's
// "identity" here is a hash of its own text (see hashText in utils.js) -
// good enough to recognize the same message again as long as its content
// hasn't changed. Bookmarks are stored per conversation (keyed by the URL
// slug), so switching chats shows a different bookmark list.
//
// Like chat-search.js, this only ever sees whatever messages are CURRENTLY
// rendered in DeepSeek's virtualized message list - jumping to a bookmark
// whose message has been virtualized out (scrolled far away) may need the
// user to scroll there themselves first, same limitation chat-search has.
//
// Depends on: config.js, dom.js, store.js (Store), utils.js
// (conversationIdFromHref, hashText, escapeHtml).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Bookmarks = {
  _processed: new WeakSet(),
  _panelOpen: false,

  // -- persistence, keyed per conversation --------------------------------

  _conversationId() {
    return conversationIdFromHref(location.pathname);
  },

  _all() {
    return Store.getBookmarks();
  },

  _forConversation(convId) {
    if (!convId) return [];
    return this._all()[convId] || [];
  },

  _saveForConversation(convId, list) {
    if (!convId) return;
    const all = this._all();
    if (list.length) all[convId] = list;
    else delete all[convId];
    Store.setBookmarks(all);
  },

  _isBookmarked(convId, key) {
    return this._forConversation(convId).some((b) => b.key === key);
  },

  _add(convId, entry) {
    const list = this._forConversation(convId);
    if (list.some((b) => b.key === entry.key)) return;
    list.push(entry);
    this._saveForConversation(convId, list);
  },

  _remove(convId, key) {
    const list = this._forConversation(convId).filter((b) => b.key !== key);
    this._saveForConversation(convId, list);
  },

  // -- message identity -----------------------------------------------------

  _isAssistantMessage(message) {
    const looksLikeUser =
      message.classList.contains('d29f3d7d') ||
      message.querySelector(CONFIG.selectors.userMessageMarker) !== null;
    return !looksLikeUser;
  },

  _messageText(message) {
    if (this._isAssistantMessage(message)) {
      return message.querySelector(CONFIG.selectors.markdown)?.textContent || '';
    }
    return (
      message.querySelector(CONFIG.selectors.userMessageMarker)?.textContent ||
      message.textContent ||
      ''
    );
  },

  _snippet(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const max = CONFIG.bookmarks.snippetLength;
    return clean.length > max ? clean.slice(0, max) + '\u2026' : clean;
  },

  // -- scanning currently-rendered messages ---------------------------------

  scan(messages) {
    try {
      this._ensureLauncher();
      const convId = this._conversationId();
      (messages || DOM.findMessages()).forEach((message) => this._processMessage(message, convId));
      this._updateBadge(convId);
    } catch (err) {
      console.debug(`${BRAND_NAME}: bookmarks error`, err);
    }
  },

  _processMessage(message, convId) {
    if (this._processed.has(message)) return;

    const text = this._messageText(message).trim();
    if (!text) return;

    const role = this._isAssistantMessage(message) ? 'assistant' : 'user';
    const key = `${role}:${hashText(text)}`;
    message.dataset.deepblueBookmarkKey = key;

    // Wrap the button + message in a positioning host so the button can be
    // docked just outside the bubble's edge instead of overlaying its text.
    const host = this._ensureHost(message, role);
    const btn = this._buildToggleButton(convId, key, role, text);
    host.appendChild(btn);

    this._processed.add(message);
  },

  // Messages render as full-width rows (the bubble itself is only part of
  // the row). We dock the button to the row, offset past the bubble on the
  // outer edge, so it never sits on top of the text - just a floating
  // marker beside the conversation, always clear of the content.
  _ensureHost(message, role) {
    if (window.getComputedStyle(message).position === 'static') {
      message.style.position = 'relative';
    }
    message.classList.add('deepblue-bookmark-host', `deepblue-bookmark-host--${role}`);

    // Belt-and-braces alongside the CSS ::after hover bridge: some hosts
    // may clip overflow in ways that break the CSS-only hit area, so track
    // hover in JS too and toggle a class that keeps the button visible.
    // This also covers the moment the pointer is travelling from the
    // bubble to the button - the button is still a descendant of `message`
    // in the DOM, so entering it never fires `mouseleave` on the host.
    if (!message.dataset.deepblueBookmarkHoverBound) {
      message.dataset.deepblueBookmarkHoverBound = 'true';
      message.addEventListener('mouseenter', () => message.classList.add('deepblue-bookmark-hover'));
      message.addEventListener('mouseleave', () => message.classList.remove('deepblue-bookmark-hover'));
    }

    return message;
  },

  _buildToggleButton(convId, key, role, text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deepblue-bookmark-btn';
    this._paintButton(btn, this._isBookmarked(convId, key));

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowBookmarked = btn.dataset.bookmarked !== 'true';
      if (nowBookmarked) {
        this._add(convId, { key, role, snippet: this._snippet(text), addedAt: Date.now() });
        btn.classList.add('deepblue-bookmark-btn--pop');
        setTimeout(() => btn.classList.remove('deepblue-bookmark-btn--pop'), 260);
      } else {
        this._remove(convId, key);
      }
      this._paintButton(btn, nowBookmarked);
      this._updateBadge(convId);
      if (this._panelOpen) this._renderPanelList();
    });

    return btn;
  },

  _paintButton(btn, bookmarked) {
    btn.dataset.bookmarked = bookmarked ? 'true' : 'false';
    btn.title = bookmarked ? 'Remove bookmark' : 'Bookmark this message';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = bookmarked
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="#ffffff" xmlns="http://www.w3.org/2000/svg"><path d="M6 3a1 1 0 0 0-1 1v17l7-4.5 7 4.5V4a1 1 0 0 0-1-1H6z"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M6 3a1 1 0 0 0-1 1v17l7-4.5 7 4.5V4a1 1 0 0 0-1-1H6z"/></svg>`;
  },

  // -- syncing any currently-mounted message's icon after a panel action ----

  _syncMessageIcon(key, bookmarked) {
    const message = document.querySelector(`[data-deepblue-bookmark-key="${key}"]`);
    const btn = message?.querySelector('.deepblue-bookmark-btn');
    if (btn) this._paintButton(btn, bookmarked);
  },

  // -- fixed launcher + panel ------------------------------------------------

  _ensureLauncher() {
    if (document.getElementById(CONFIG.ids.bookmarkLauncher)) {
      this._repositionLauncher();
      return;
    }
    this._injectStyles();
    document.body.appendChild(this._buildLauncher());
    this._watchLauncherPosition();
  },

  _injectStyles() {
    if (document.getElementById('deepblue-bookmark-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-bookmark-styles';
    style.textContent = `
    @keyframes deepblue-bookmark-pulse {
      0% { box-shadow: 0 0 0 0 rgba(var(--db-accent-rgb), 0.5); }
      70% { box-shadow: 0 0 0 10px rgba(var(--db-accent-rgb), 0); }
      100% { box-shadow: 0 0 0 0 rgba(var(--db-accent-rgb), 0); }
    }

    @keyframes deepblue-bookmark-pop {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.35); }
      100% { transform: scale(1); }
    }

    /* Docked marker, sits just outside the message row rather than on top
       of its text. Hidden by default, revealed on hover - except once a
       message is bookmarked, where it stays visible as a permanent marker.

       The button renders outside the host's own box (right: -34px), so a
       plain ":hover on host -> show button" rule has a dead gap: the
       moment the cursor leaves the host's box on its way to the button,
       the hover ends and the button disappears before it can be clicked.
       To fix that we extend the host's actual hoverable hit area with an
       invisible ::after strip that spans the gap plus the button itself,
       so the whole path from bubble to button stays continuously hovered. */
    .deepblue-bookmark-host {
      --deepblue-bookmark-offset: -34px;
    }

    .deepblue-bookmark-host::after {
      content: '';
      position: absolute;
      top: 0;
      right: var(--deepblue-bookmark-offset);
      width: 40px;
      height: 100%;
      min-height: 40px;
    }

    .deepblue-bookmark-btn {
      position: absolute;
      top: 2px;
      right: var(--deepblue-bookmark-offset);
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1.5px solid var(--db-border);
      cursor: pointer;
      padding: 0;
      background: var(--db-surface);
      color: var(--db-text-tertiary);
      box-shadow: var(--db-shadow-sm);
      opacity: 0;
      transform: scale(0.85);
      transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease,
        border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
      pointer-events: none;
    }

    .deepblue-bookmark-host:hover .deepblue-bookmark-btn,
    .deepblue-bookmark-host.deepblue-bookmark-hover .deepblue-bookmark-btn,
    .deepblue-bookmark-host:focus-within .deepblue-bookmark-btn,
    .deepblue-bookmark-btn:focus-visible {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }

    .deepblue-bookmark-btn:hover {
      border-color: var(--db-accent);
      color: var(--db-accent);
      box-shadow: 0 3px 10px rgba(var(--db-accent-rgb), 0.22);
      transform: scale(1.08);
    }

    .deepblue-bookmark-btn[data-bookmarked="true"] {
      opacity: 1;
      pointer-events: auto;
      background: var(--db-accent);
      border-color: var(--db-accent);
      color: var(--db-surface);
      box-shadow: 0 2px 8px rgba(var(--db-accent-rgb), 0.35);
    }

    .deepblue-bookmark-btn[data-bookmarked="true"]:hover {
      background: var(--db-accent-hover);
      border-color: var(--db-accent-hover);
      box-shadow: 0 3px 12px rgba(var(--db-accent-rgb), 0.4);
    }

    .deepblue-bookmark-btn--pop {
      animation: deepblue-bookmark-pop 0.26s ease;
    }

    /* Narrow viewports: no room to dock outside the bubble, so fall back to
       a corner overlay, but with a solid background and clear contrast
       instead of a translucent icon sitting on top of the text. */
    @media (max-width: 860px) {
      .deepblue-bookmark-btn {
        top: 6px;
        right: 6px;
      }
    }
    `;
    document.head.appendChild(style);
  },

  // Nuclear option: stop trying to identify "the Share button" by
  // selector entirely - DeepSeek's markup has proven unreliable (no
  // title, duplicate zero-size ghost nodes, selectors that silently stop
  // matching after a redesign). Instead, do real collision detection:
  // place the launcher at its default spot, then ask the browser what is
  // ACTUALLY painted under its four corners (elementFromPoint only ever
  // returns real, visible, hit-testable elements - ghost/hidden nodes
  // can't produce a false positive here). If anything but our own
  // launcher/its children is there, treat it as an obstacle, measure it,
  // and step left until clear. This works regardless of what DeepSeek's
  // header contains or how it's classed, today or after any future
  // redesign.
  _FALLBACK_LAUNCHER_TOP: 14,
  _FALLBACK_LAUNCHER_RIGHT: 14,

  _elementsUnderLauncher(wrap, top, right) {
    const left = window.innerWidth - right - wrap.offsetWidth;
    const size = wrap.offsetWidth;
    const probes = [
      [left + 2, top + 2],
      [left + size - 2, top + 2],
      [left + 2, top + size - 2],
      [left + size - 2, top + size - 2],
      [left + size / 2, top + size / 2],
    ];

    const found = new Set();
    probes.forEach(([x, y]) => {
      document.elementsFromPoint(x, y).forEach((el) => {
        if (el === wrap || wrap.contains(el)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        // Only treat genuinely small, button-sized things as obstacles.
        // Large layout containers (the message list, page background,
        // content column, header bar itself) are exactly what sits
        // *behind* real buttons at every probe point via elementsFromPoint
        // (it returns the whole stack, not just the topmost element), and
        // treating THEIR width as the thing to dodge is what pushed the
        // launcher off-screen: a wide container's right edge can be
        // almost the full viewport width, so "step past its edge" means
        // stepping thousands of pixels left. Real header buttons/icons
        // are small - cap both dimensions generously above icon-button
        // size and reject anything bigger.
        if (rect.width > 120 || rect.height > 120) return;
        found.add(el);
      });
    });
    return Array.from(found);
  },

  _repositionLauncher() {
    const wrap = document.getElementById(CONFIG.ids.bookmarkLauncher);
    if (!wrap) return;

    const gap = 10;
    let top = this._FALLBACK_LAUNCHER_TOP;
    let right = this._FALLBACK_LAUNCHER_RIGHT;
    wrap.style.top = `${top}px`;
    wrap.style.right = `${right}px`;

    // Only bother avoiding things near the top of the page (the header
    // band) - never let this logic go chasing something further down.
    if (top > 100) return;

    const maxSteps = 20;
    for (let i = 0; i < maxSteps; i++) {
      const obstacles = this._elementsUnderLauncher(wrap, top, right);
      if (!obstacles.length) return;

      // Push right (== move further left on screen) past the widest
      // obstacle actually overlapping us, so one step clears it fully
      // instead of nudging pixel by pixel into more collisions.
      const widestRightEdge = obstacles.reduce((maxRight, el) => {
        const r = el.getBoundingClientRect();
        return Math.max(maxRight, window.innerWidth - r.left);
      }, 0);

      const nextRight = widestRightEdge + gap;
      if (nextRight <= right) {
        // Safety net against an infinite loop if something reports a
        // rect that doesn't actually move us forward.
        right += 40;
      } else {
        right = nextRight;
      }

      // Hard ceiling: never let the launcher be pushed far enough that it
      // leaves the viewport, no matter what an obstacle measurement says.
      const maxRight = window.innerWidth - wrap.offsetWidth - 8;
      if (right > maxRight) {
        right = Math.max(this._FALLBACK_LAUNCHER_RIGHT, maxRight);
        wrap.style.right = `${right}px`;
        return;
      }

      wrap.style.right = `${right}px`;
    }
  },

  _watchLauncherPosition() {
    if (this._launcherReposObserver) return;

    const reposition = () => this._repositionLauncher();

    // Debounced: this also runs off a body-wide MutationObserver, and a
    // streaming assistant reply can mutate the DOM dozens of times a
    // second - repositioning on every single one would be wasteful.
    let raf = null;
    const scheduleReposition = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        reposition();
      });
    };

    window.addEventListener('resize', scheduleReposition);
    window.addEventListener('scroll', scheduleReposition, true);

    // Covers Share appearing/disappearing or the header re-rendering
    // (route changes, sidebar toggle) without a resize/scroll event.
    this._launcherReposObserver = new MutationObserver(scheduleReposition);
    this._launcherReposObserver.observe(document.body, { childList: true, subtree: true });

    reposition();
  },

  _buildLauncher() {
    const wrap = document.createElement('div');
    wrap.id = CONFIG.ids.bookmarkLauncher;
    wrap.style.cssText = `
    position: fixed;
    top: ${this._FALLBACK_LAUNCHER_TOP}px;
    right: ${this._FALLBACK_LAUNCHER_RIGHT}px;
    z-index: 999999;
    transition: top 0.15s ease, right 0.15s ease;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Bookmarked messages in this chat';
    btn.style.cssText = `
    position: relative;
    display: flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: 50%;
    background: var(--db-surface); border: 1px solid var(--db-border); box-shadow: var(--db-shadow-md);
    cursor: pointer; color: var(--db-accent); padding: 0;
    transition: box-shadow 0.15s ease, transform 0.1s ease;
    `;
    btn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 3a1 1 0 0 0-1 1v17l7-4.5 7 4.5V4a1 1 0 0 0-1-1H6z"/>
    </svg>
    `;
    btn.addEventListener('mouseenter', () => (btn.style.transform = 'scale(1.06)'));
    btn.addEventListener('mouseleave', () => (btn.style.transform = 'scale(1)'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePanel();
    });
    wrap.appendChild(btn);
    this._launcherBtn = btn;

    const badge = document.createElement('div');
    badge.id = CONFIG.ids.bookmarkBadge;
    badge.style.cssText = `
    position: absolute; top: -4px; right: -4px;
    min-width: 16px; height: 16px; padding: 0 3px; border-radius: 999px;
    background: var(--db-danger); color: var(--db-surface); font-size: 10px; font-weight: 700;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 0 0 2px var(--db-surface);
    `;
    btn.appendChild(badge);
    this._badgeEl = badge;

    document.addEventListener('click', (e) => {
      if (!this._panelOpen) return;
      const panel = document.getElementById(CONFIG.ids.bookmarkPanel);
      if (panel && (panel.contains(e.target) || wrap.contains(e.target))) return;
      this._closePanel();
    });

    return wrap;
  },

  _updateBadge(convId) {
    const badge = this._badgeEl || document.getElementById(CONFIG.ids.bookmarkBadge);
    if (!badge) return;
    const count = this._forConversation(convId).length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'flex' : 'none';
  },

  _togglePanel() {
    if (this._panelOpen) this._closePanel();
    else this._openPanel();
  },

  _openPanel() {
    this._panelOpen = true;
    const launcher = document.getElementById(CONFIG.ids.bookmarkLauncher);
    if (!launcher) return;

    const panel = document.createElement('div');
    panel.id = CONFIG.ids.bookmarkPanel;
    panel.style.cssText = `
    position: fixed;
    top: 58px;
    right: 14px;
    width: 300px;
    max-height: 420px;
    background: var(--db-surface);
    border: 1px solid var(--db-border);
    border-radius: 14px;
    box-shadow: var(--db-shadow-lg);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-bottom: 1px solid var(--db-surface-hover); flex-shrink: 0;
    `;
    header.innerHTML = `<span style="font-size:13px; font-weight:700; color:var(--db-text);">Bookmarks in this chat</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.style.cssText =
      'border:none; background:none; cursor:pointer; color:var(--db-text-secondary); font-size:16px; line-height:1; padding:2px;';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closePanel();
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y: auto; flex: 1 1 auto;';
    panel.appendChild(list);
    this._listEl = list;

    document.body.appendChild(panel);
    this._renderPanelList();
  },

  _closePanel() {
    this._panelOpen = false;
    document.getElementById(CONFIG.ids.bookmarkPanel)?.remove();
    this._listEl = null;
  },

  _renderPanelList() {
    const list = this._listEl || document.querySelector(`#${CONFIG.ids.bookmarkPanel} > div:last-child`);
    if (!list) return;

    const convId = this._conversationId();
    const entries = this._forConversation(convId);

    list.innerHTML = '';

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.style.cssText =
        'padding: 24px 16px; text-align:center; color:var(--db-text-secondary); font-size:12.5px; line-height:1.5;';
      empty.textContent =
        'No bookmarks yet. Hover a message and click the bookmark icon in its corner to save it here.';
      list.appendChild(empty);
      return;
    }

    entries
      .slice()
      .reverse()
      .forEach((entry) => list.appendChild(this._buildEntryRow(convId, entry)));
  },

  _buildEntryRow(convId, entry) {
    const row = document.createElement('div');
    row.style.cssText = `
    display: flex; align-items: flex-start; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--db-surface-sunken); cursor: pointer;
    transition: background 0.12s ease;
    `;
    row.addEventListener('mouseenter', () => (row.style.background = 'var(--db-surface-hover)'));
    row.addEventListener('mouseleave', () => (row.style.background = 'none'));
    row.addEventListener('click', () => this._goTo(entry.key));

    const roleTag = document.createElement('div');
    roleTag.style.cssText = `
    flex-shrink: 0; margin-top: 1px; font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: ${entry.role === 'user' ? 'var(--db-accent)' : '#22c55e'};
    `;
    roleTag.textContent = entry.role === 'user' ? 'You' : 'AI';
    row.appendChild(roleTag);

    const text = document.createElement('div');
    text.style.cssText =
      'flex: 1 1 auto; min-width: 0; font-size: 12.5px; color: var(--db-text); line-height: 1.4;';
    text.textContent = entry.snippet;
    row.appendChild(text);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Remove bookmark';
    remove.style.cssText = `
    flex-shrink: 0; border: none; background: none; cursor: pointer; color: var(--db-border-strong);
    font-size: 15px; line-height: 1; padding: 0 2px;
    `;
    remove.textContent = '\u00d7';
    remove.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      remove.style.color = 'var(--db-danger)';
    });
    remove.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      remove.style.color = 'var(--db-border-strong)';
    });
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      this._remove(convId, entry.key);
      this._syncMessageIcon(entry.key, false);
      this._updateBadge(convId);
      this._renderPanelList();
    });
    row.appendChild(remove);

    return row;
  },

  _goTo(key) {
    const message = document.querySelector(`[data-deepblue-bookmark-key="${key}"]`);
    if (!message) {
      this._flashListNotice('This message isn\u2019t currently loaded \u2013 try scrolling up in the chat first.');
      return;
    }

    this._closePanel();
    message.scrollIntoView({ block: 'center', behavior: 'smooth' });

    const originalTransition = message.style.transition;
    const originalShadow = message.style.boxShadow;
    message.style.transition = 'box-shadow 0.2s ease';
    message.style.animation = 'deepblue-bookmark-pulse 0.8s ease 2';
    setTimeout(() => {
      message.style.animation = '';
      message.style.transition = originalTransition;
      message.style.boxShadow = originalShadow;
    }, 1700);
  },

  _flashListNotice(text) {
    const list = this._listEl;
    if (!list) return;
    const notice = document.createElement('div');
    notice.style.cssText =
      'padding: 8px 12px; font-size: 11.5px; color: var(--db-danger); background: var(--db-danger-soft); border-bottom: 1px solid var(--db-danger-soft);';
    notice.textContent = text;
    list.prepend(notice);
    setTimeout(() => notice.remove(), 2500);
  },
};
