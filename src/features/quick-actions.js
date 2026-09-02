// features/quick-actions.js - two double-click shortcuts:
//
//   1. Double-click a conversation title in the sidebar -> opens
//      DeepSeek's own rename flow automatically (hover the row to reveal
//      its "..." button, click it, find and click its "Rename" menu item,
//      then focus+select the resulting input DeepSeek swaps in).
//   2. Double-click a message you sent -> clicks DeepSeek's own pencil
//      "edit" button for that message, so it enters DeepSeek's native
//      edit mode without hunting for the small icon yourself.
//
// Both reuse DeepSeek's real UI/logic rather than reimplementing rename
// or edit ourselves - we're just automating the click path, which keeps
// persistence (actually renaming server-side, actually resubmitting an
// edited message) fully correct and owned by DeepSeek's own code.
//
// DeepSeek keeps the "..." button and the rename input's trigger truly
// hidden (width/height: 0) until the row is hovered, so a plain .click()
// on it does nothing until we first dispatch a synthetic hover sequence.
//
// Depends on: config.js, dom.js, utils.js (debounce/hashText not needed
// here, but relies on the shared realm like every other feature file).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array.

'use strict';

const QuickActions = {
  _processedMessages: new WeakSet(),
  _processedSidebarLinks: new WeakSet(),

  scan(messages, sidebarLinks) {
    try {
      this._injectStyles();
      this._wireMessages(messages);
      this._wireSidebarLinks(sidebarLinks);
    } catch (err) {
      console.debug(`${BRAND_NAME}: quick-actions error`, err);
    }
  },

  // -- shared: small hover-hint styling + toast ------------------------------

  _injectStyles() {
    if (document.getElementById('deepblue-quick-actions-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-quick-actions-styles';
    style.textContent = `
    @keyframes deepblue-qa-toast-in {
      from { opacity: 0; transform: translate(-50%, 6px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    .deepblue-qa-toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translate(-50%, 0);
      z-index: 999999;
      background: var(--db-text);
      color: var(--db-surface);
      font-size: 12.5px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      padding: 8px 14px;
      border-radius: 999px;
      box-shadow: var(--db-shadow-lg);
      pointer-events: none;
      animation: deepblue-qa-toast-in 0.15s ease;
    }

    /* Subtle cue that these are double-click enabled, without adding
       visible chrome to every row/message all the time. */
    .deepblue-qa-dbl-hint {
      cursor: default;
    }
    `;
    document.head.appendChild(style);
  },

  _toast(text) {
    const existing = document.querySelector('.deepblue-qa-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'deepblue-qa-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  },

  // Dispatches a realistic enough hover sequence that React's hover-driven
  // visibility (opacity/width/height toggled via CSS on :hover, or a
  // hover state tracked in JS via onMouseEnter) actually engages, so a
  // normally-hidden button becomes clickable without the user manually
  // hovering first.
  _simulateHover(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
  },

  _simulateClick(el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  },

  // -- 1. sidebar: double-click title to rename ------------------------------

  _wireSidebarLinks(links) {
    (links || DOM.getSidebarConversationLinks()).forEach((link) => {
      if (this._processedSidebarLinks.has(link)) return;
      this._processedSidebarLinks.add(link);
      link.classList.add('deepblue-qa-dbl-hint');
      link.addEventListener('dblclick', (e) => this._handleTitleDoubleClick(e, link));
    });
  },

  _handleTitleDoubleClick(e, link) {
    // Don't hijack a double-click on the "..." button, folder star, or
    // any of DeepBlue's own controls already living in this row.
    if (e.target.closest('.deepblue-add-to-folder-btn')) return;
    if (e.target.closest(CONFIG.selectors.sidebarConversationMenuBtn)) return;

    e.preventDefault();
    e.stopPropagation();

    // The first of the two clicks that make up this dblclick may have
    // already triggered SPA navigation (if this row wasn't already the
    // active conversation), which can cause DeepSeek's virtualized list
    // to re-render and recycle/replace this exact DOM node. Re-resolve
    // the row by its href right before acting, instead of trusting the
    // closure's `link` reference across that possible re-render.
    const href = link.getAttribute('href');
    const freshLink =
      (href && document.querySelector(`a._546d736[href="${CSS.escape(href)}"]`)) || link;

    const menuWrap = freshLink.querySelector(CONFIG.selectors.sidebarConversationMenuWrap);
    const menuBtn = freshLink.querySelector(CONFIG.selectors.sidebarConversationMenuBtn);
    if (!menuBtn) {
      this._toast('Couldn\u2019t find the conversation menu \u2013 try the \u2022\u2022\u2022 button.');
      return;
    }

    // The "..." button is width:0/height:0 until the row is hovered -
    // force that hover state on both the row and the wrapper around the
    // button before trying to click it.
    this._simulateHover(freshLink);
    this._simulateHover(menuWrap || menuBtn);
    this._simulateHover(menuBtn);

    // Give DeepSeek's own hover-triggered re-render a frame to actually
    // lay the button out before we try to click it.
    requestAnimationFrame(() => {
      this._simulateClick(menuBtn);
      this._findAndClickRenameMenuItem(freshLink);
    });
  },

  // The dropdown menu DeepSeek opens is portalled (appended near the end
  // of <body>, not inside the sidebar row), and its classes aren't stable
  // enough to rely on - so find it by its visible text instead, which is
  // far more robust to markup/class changes.
  _findAndClickRenameMenuItem(link) {
    const attempt = (triesLeft) => {
      const candidates = Array.from(document.querySelectorAll('body *')).filter((el) => {
        if (el.children.length > 0) return false;
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'rename';
      });

      if (candidates.length) {
        // Click the element itself, and if that doesn't seem to do
        // anything (no input appears shortly after), try its clickable
        // ancestor (menu items are often a leaf label inside a larger
        // clickable row).
        const target = candidates[0].closest('[role="menuitem"], li, button, div') || candidates[0];
        this._simulateClick(target);
        this._focusRenameInputWhenReady(link);
        return;
      }

      if (triesLeft > 0) {
        setTimeout(() => attempt(triesLeft - 1), 60);
      } else {
        this._toast('Rename menu didn\u2019t open \u2013 try the \u2022\u2022\u2022 button.');
      }
    };

    attempt(8);
  },

  // Once "Rename" is clicked, DeepSeek swaps the title into a real
  // <input class="ds-input__input">. Focus it and select all its text so
  // the person can just start typing over it immediately.
  _focusRenameInputWhenReady(link) {
    const attempt = (triesLeft) => {
      const input =
        link.querySelector('input.ds-input__input') ||
        link.querySelector('input[type="text"]') ||
        document.querySelector('input.ds-input__input');

      if (input) {
        input.focus();
        input.select();
        return;
      }

      if (triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 60);
    };

    attempt(8);
  },

  // -- 2. messages: double-click a user message to edit ----------------------

  _wireMessages(messages) {
    (messages || DOM.findMessages()).forEach((message) => {
      if (this._processedMessages.has(message)) return;
      // Only user-sent messages have an edit button - assistant replies
      // don't, and we shouldn't pretend otherwise.
      const isUser = message.classList.contains('d29f3d7d');
      if (!isUser) {
        this._processedMessages.add(message);
        return;
      }

      this._processedMessages.add(message);
      message.classList.add('deepblue-qa-dbl-hint');
      message.addEventListener('dblclick', (e) => this._handleMessageDoubleClick(e, message));
    });
  },

  _handleMessageDoubleClick(e, message) {
    // Don't hijack double-clicking our own bookmark button or any
    // existing text-selection-friendly interaction inside the bubble
    // itself - only the bubble background/text should trigger this.
    if (e.target.closest('.deepblue-bookmark-btn')) return;

    const editBtn = this._findEditButton(message);
    if (!editBtn) {
      this._toast('Couldn\u2019t find the edit button for this message.');
      return;
    }

    e.preventDefault();
    // Clear any text selection the double-click itself may have started,
    // so it doesn't fight with DeepSeek's own edit-mode text selection.
    window.getSelection()?.removeAllRanges();

    this._simulateHover(message);
    requestAnimationFrame(() => this._simulateClick(editBtn));
  },

  // The action row (copy + edit) sits as a sibling of the message inside
  // a shared wrapper, always present in the DOM but hidden until hover.
  // Edit is the LAST .ds-button inside that row (copy is first).
  _findEditButton(message) {
    const parent = message.parentElement;
    const row =
      parent?.querySelector(CONFIG.selectors.userMessageActionRow) ||
      (message.nextElementSibling?.matches?.(CONFIG.selectors.userMessageActionRow)
        ? message.nextElementSibling
        : null);

    if (!row) return null;
    const buttons = row.querySelectorAll('.ds-button');
    if (!buttons.length) return null;
    return buttons[buttons.length - 1];
  },
};
