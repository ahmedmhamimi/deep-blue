// store.js - thin, error-safe localStorage wrapper for folder + tone-preset data.
//
// Depends on: config.js (CONFIG, BRAND_NAME).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Store = {
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      console.debug(`${BRAND_NAME}: storage read error`, err);
      return fallback;
    }
  },

  _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.debug(`${BRAND_NAME}: storage write error`, err);
      return false;
    }
  },

  getFolders() {
    return this._read(CONFIG.folders.storageKey, []);
  },

  setFolders(folders) {
    return this._write(CONFIG.folders.storageKey, folders);
  },

  getAssignments() {
    // conversationId -> folderId
    return this._read(CONFIG.folders.assignmentsKey, {});
  },

  setAssignments(assignments) {
    return this._write(CONFIG.folders.assignmentsKey, assignments);
  },

  getToneState() {
    return this._read(CONFIG.tone.storageKey, { selectedId: 'none', customTones: [] });
  },

  setToneState(state) {
    return this._write(CONFIG.tone.storageKey, state);
  },

  // conversationId (or 'new' pre-first-message) -> last tone id actually
  // told to the model in that conversation. Lets us only append the tag
  // when the tone actually changes, instead of on every single message -
  // DeepSeek already carries it forward via chat history once stated.
  getToneLastInjected() {
    return this._read(CONFIG.tone.lastInjectedKey, {});
  },

  setToneLastInjected(map) {
    return this._write(CONFIG.tone.lastInjectedKey, map);
  },

  // conversationId -> [{key, role, snippet, addedAt}], newest-added last.
  getBookmarks() {
    return this._read(CONFIG.bookmarks.storageKey, {});
  },

  setBookmarks(map) {
    return this._write(CONFIG.bookmarks.storageKey, map);
  },

  // [{id, title, content, createdAt}], shared across every conversation.
  // Fallback is `null` (not `[]`) so PromptLibrary can tell "never saved
  // anything yet" apart from "user deleted every prompt on purpose" and
  // only seed the built-in defaults in the first case.
  getPrompts() {
    return this._read(CONFIG.prompts.storageKey, null);
  },

  setPrompts(list) {
    return this._write(CONFIG.prompts.storageKey, list);
  },
};
