// theme.js - detects whether DeepSeek is currently in light or dark mode
// and mirrors that onto `<html data-db-theme="light|dark">`, which
// theme.css keys every token off of. This is the ONLY thing that decides
// DeepBlue's color scheme - individual features never hardcode a mode.
//
// DeepSeek's own theme can change at runtime (user toggles it, or OS-level
// prefers-color-scheme changes and the site follows it) without a full page
// reload, so this re-checks on every bootstrap scan tick rather than once.
//
// Depends on: nothing (pure DOM/CSS reads). Must load before any feature
// that renders UI, so put it early in manifest.json's content_scripts[].js
// array (right after config.js).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array.

'use strict';

const Theme = {
  _lastMode: null,

  // Multiple independent signals, checked cheapest/most-specific first.
  // DeepSeek has changed its dark-mode markup before, so no single signal
  // is trusted alone - the page's actual rendered background color is the
  // fallback ground truth (a dark background is dark mode, full stop,
  // regardless of what class or attribute produced it).
  _detectDark() {
    const html = document.documentElement;
    const body = document.body;

    if (html.classList.contains('dark') || body?.classList.contains('dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (html.getAttribute('theme-mode') === 'dark') return true;
    if (html.classList.contains('light') || body?.classList.contains('light')) return false;
    if (html.getAttribute('data-theme') === 'light') return false;

    const bg = getComputedStyle(body || html).backgroundColor;
    const rgb = bg && bg.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const [r, g, b] = rgb.map(Number);
      // Perceived luminance - standard broadcast-luma weights.
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      return luminance < 128;
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  },

  sync() {
    const isDark = this._detectDark();
    const mode = isDark ? 'dark' : 'light';
    if (mode === this._lastMode) return;
    this._lastMode = mode;
    document.documentElement.setAttribute('data-db-theme', mode);
  },
};
