// features/generation-timer.js - wall-clock time between a sent message and its reply.
//
// No dependencies on other DeepBlue modules.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

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
