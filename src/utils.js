// utils.js - small, dependency-free helper functions.
//
// debounce / queryFirst / escapeHtml / sanitizeFilename / nextFrame /
// conversationIdFromHref / uid. Depends only on config.js (BRAND_NAME) for
// one debug log line.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

function debounce(fn, waitMs) {
  let handle = null;
  return function debounced(...args) {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn.apply(this, args);
    }, waitMs);
  };
}

function queryFirst(selectors, root = document) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const sel of list) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const escapeSink = document.createElement('div');
function escapeHtml(text) {
  escapeSink.textContent = text == null ? '' : String(text);
  return escapeSink.innerHTML;
}

function sanitizeFilename(name) {
  return (
    (name || 'DeepSeek-Conversation')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'DeepSeek-Conversation'
  );
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

// Sets a value on a React-controlled <textarea>/<input> the "real" way: by
// calling the native property setter (bypassing the element's own
// overridden `value` setter that React installs) and then dispatching a
// real 'input' event. A plain `el.value = x` would update the DOM but
// React's internal state would never see it - the framework would just
// re-render over it or ignore it entirely.
function setNativeInputValue(element, value) {
  const proto =
    element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function conversationIdFromHref(href) {
  if (!href) return null;
  const match = href.match(/\/chat\/s\/([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

function uid() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
