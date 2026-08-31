// dom.js - all live DOM lookups against DeepSeek's page.
//
// Every querySelector call for the host page (as opposed to DeepBlue's own
// injected UI) lives here, so selector fallback logic is easy to find and
// fix in one place when DeepSeek changes its markup.
// Depends on: config.js (CONFIG), utils.js (queryFirst).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const DOM = {
  findSendButtonWrapper() {
    const fileInput = document.querySelector(CONFIG.selectors.fileInput);
    const scope = fileInput?.closest('.bf38813a') || fileInput?.parentElement || document;
    const wrapper =
      scope.querySelector(CONFIG.selectors.fitContentWrapper) ||
      scope
        .querySelector(CONFIG.selectors.primaryCircleButton)
        ?.closest(CONFIG.selectors.fitContentWrapper);
    return (
      wrapper || scope.querySelector?.(CONFIG.selectors.primaryCircleButton)?.parentElement || null
    );
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
    const scope =
      textarea?.closest('form') ||
      textarea?.parentElement?.parentElement?.parentElement ||
      document;

    // Search only exists in Instant mode's composer (Expert/Vision hide it
    // once a chat is active); DeepThink exists in all of them. Anchor on
    // whichever is actually there: Search when available (so the meter
    // lands beside it, as in Instant mode), DeepThink otherwise (Expert /
    // Vision mode).
    return this._findToggleRow(scope, 'search') || this._findToggleRow(scope, 'deepthink');
  },

  // Finds the leaf text node matching `label` (a mode-toggle pill's
  // label), then climbs out of its own label/icon wrapper spans until it
  // reaches the actual pill element (icon + label, so more than one
  // child), and returns THAT pill's parent - the row laying sibling pills
  // out side by side. Returning anything still inside the pill itself
  // would make a newly appended sibling (our context meter) render inside
  // the pill's own border/background instead of next to it.
  _findToggleRow(scope, label) {
    const candidates = scope.querySelectorAll('div, button, span');
    for (const el of candidates) {
      if (el.children.length > 0) continue;
      if (el.textContent?.trim().toLowerCase() !== label) continue;

      let node = el.parentElement;
      let guard = 0;
      while (node && node.children.length <= 1 && guard < 6) {
        node = node.parentElement;
        guard++;
      }
      return node?.parentElement || node || el.parentElement;
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
        if (
          tag === 'header' ||
          parent.className?.includes?.('header') ||
          parent.className?.includes?.('title-bar') ||
          parent.className?.includes?.('conversation-header')
        ) {
          return parent;
        }
        parent = parent.parentElement;
        attempts++;
      }
      return (
        el.closest('header') ||
        el.closest('[class*="header"]') ||
        el.parentElement?.parentElement ||
        null
      );
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
      const msg =
        item.querySelector(CONFIG.selectors.messages[0]) ||
        item.querySelector(CONFIG.selectors.messages[1]);
      if (msg) messages.push(msg);
    });
    return messages.length ? messages : this.findMessages();
  },

  findSidebarNewChatRow() {
    return document.querySelector(CONFIG.selectors.sidebarNewChatRow);
  },

  findSidebarListGroups() {
    return document.querySelector(CONFIG.selectors.sidebarListGroups);
  },

  getSidebarConversationLinks() {
    return Array.from(document.querySelectorAll(CONFIG.selectors.sidebarConversationLink));
  },
};
