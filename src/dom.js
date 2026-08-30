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
