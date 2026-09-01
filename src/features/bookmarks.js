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

  scan() {
    try {
      this._ensureLauncher();
      const convId = this._conversationId();
      const messages = DOM.findMessages();
      messages.forEach((message) => this._processMessage(message, convId));
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

    if (window.getComputedStyle(message).position === 'static') {
      message.style.position = 'relative';
    }

    const btn = this._buildToggleButton(convId, key, role, text);
    message.appendChild(btn);

    this._processed.add(message);
  },

  _buildToggleButton(convId, key, role, text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deepblue-bookmark-btn';
    btn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    padding: 0;
    background: rgba(255,255,255,0.9);
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    `;
    this._paintButton(btn, this._isBookmarked(convId, key));

    btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
    btn.addEventListener('mouseleave', () => {
      if (btn.dataset.bookmarked !== 'true') btn.style.opacity = '0.35';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowBookmarked = btn.dataset.bookmarked !== 'true';
      if (nowBookmarked) {
        this._add(convId, { key, role, snippet: this._snippet(text), addedAt: Date.now() });
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
    btn.style.opacity = bookmarked ? '1' : '0.35';
    btn.title = bookmarked ? 'Remove bookmark' : 'Bookmark this message';
    btn.innerHTML = bookmarked
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="#3964fe" xmlns="http://www.w3.org/2000/svg"><path d="M6 3a1 1 0 0 0-1 1v17l7-4.5 7 4.5V4a1 1 0 0 0-1-1H6z"/></svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6c6c72" stroke-width="1.8" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M6 3a1 1 0 0 0-1 1v17l7-4.5 7 4.5V4a1 1 0 0 0-1-1H6z"/></svg>`;
  },

  // -- syncing any currently-mounted message's icon after a panel action ----

  _syncMessageIcon(key, bookmarked) {
    const message = document.querySelector(`[data-deepblue-bookmark-key="${key}"]`);
    const btn = message?.querySelector('.deepblue-bookmark-btn');
    if (btn) this._paintButton(btn, bookmarked);
  },

  // -- fixed launcher + panel ------------------------------------------------

  _ensureLauncher() {
    if (document.getElementById(CONFIG.ids.bookmarkLauncher)) return;
    this._injectStyles();
    document.body.appendChild(this._buildLauncher());
  },

  _injectStyles() {
    if (document.getElementById('deepblue-bookmark-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-bookmark-styles';
    style.textContent = `
    @keyframes deepblue-bookmark-pulse {
      0% { box-shadow: 0 0 0 0 rgba(57,100,254,0.5); }
      70% { box-shadow: 0 0 0 10px rgba(57,100,254,0); }
      100% { box-shadow: 0 0 0 0 rgba(57,100,254,0); }
    }
    `;
    document.head.appendChild(style);
  },

  _buildLauncher() {
    const wrap = document.createElement('div');
    wrap.id = CONFIG.ids.bookmarkLauncher;
    wrap.style.cssText = `
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Bookmarked messages in this chat';
    btn.style.cssText = `
    position: relative;
    display: flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: 50%;
    background: #ffffff; border: 1px solid #e5e7eb; box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    cursor: pointer; color: #3964fe; padding: 0;
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
    background: #ef4444; color: #ffffff; font-size: 10px; font-weight: 700;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 0 0 2px #ffffff;
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
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.15);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-bottom: 1px solid #f0f1f4; flex-shrink: 0;
    `;
    header.innerHTML = `<span style="font-size:13px; font-weight:700; color:#1d1d1f;">Bookmarks in this chat</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.style.cssText =
      'border:none; background:none; cursor:pointer; color:#8e8e93; font-size:16px; line-height:1; padding:2px;';
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
        'padding: 24px 16px; text-align:center; color:#8e8e93; font-size:12.5px; line-height:1.5;';
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
    padding: 10px 12px; border-bottom: 1px solid #f5f6f8; cursor: pointer;
    transition: background 0.12s ease;
    `;
    row.addEventListener('mouseenter', () => (row.style.background = '#f7f8fa'));
    row.addEventListener('mouseleave', () => (row.style.background = 'none'));
    row.addEventListener('click', () => this._goTo(entry.key));

    const roleTag = document.createElement('div');
    roleTag.style.cssText = `
    flex-shrink: 0; margin-top: 1px; font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: ${entry.role === 'user' ? '#3964fe' : '#22c55e'};
    `;
    roleTag.textContent = entry.role === 'user' ? 'You' : 'AI';
    row.appendChild(roleTag);

    const text = document.createElement('div');
    text.style.cssText =
      'flex: 1 1 auto; min-width: 0; font-size: 12.5px; color: #1d1d1f; line-height: 1.4;';
    text.textContent = entry.snippet;
    row.appendChild(text);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Remove bookmark';
    remove.style.cssText = `
    flex-shrink: 0; border: none; background: none; cursor: pointer; color: #c9ccd3;
    font-size: 15px; line-height: 1; padding: 0 2px;
    `;
    remove.textContent = '\u00d7';
    remove.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      remove.style.color = '#ef4444';
    });
    remove.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      remove.style.color = '#c9ccd3';
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
      'padding: 8px 12px; font-size: 11.5px; color: #ef4444; background: #fef2f2; border-bottom: 1px solid #fde8e8;';
    notice.textContent = text;
    list.prepend(notice);
    setTimeout(() => notice.remove(), 2500);
  },
};
