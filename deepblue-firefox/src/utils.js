// utils.js - small, dependency-free helper functions.
//
// debounce / queryFirst / escapeHtml / sanitizeFilename / nextFrame /
// setNativeInputValue / conversationIdFromHref / uid / isInsideDeepBlueUI /
// isDeepBlueOwnedElement / pluralize / hashText / htmlNodeToPlainText.
// Depends only on config.js (BRAND_NAME) for one debug log line.
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

// True if `node` (or any ancestor of it) is part of DeepBlue's own
// injected UI, using the single naming convention every DeepBlue element
// follows - an id or class containing 'deepblue-', or (for a couple of
// plain-dataset markers, e.g. Folders' sidebar-row decoration) a
// data-deepblue-* attribute. One attribute-selector query covers all of
// it, so a brand-new feature's ids/classes are automatically recognized
// here without this function (or its callers) needing to be updated -
// unlike an explicit per-feature id/class list, which silently stops
// covering anything new the moment someone forgets to add it.
function isInsideDeepBlueUI(node) {
  if (!node) return false;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('[id^="deepblue-"], [class*="deepblue-"], [data-deepblue-folderized]');
}

// True for any element that's part of DeepBlue's own injected UI (as
// opposed to DeepSeek's native page). Every id DeepBlue assigns is
// prefixed 'deepblue-' (see config.js's CONFIG.ids), so this one check
// covers all of them - including ones added after this function was
// written - without every call site needing its own growing list of
// specific ids to exclude. Used where a selector deliberately matches
// DeepSeek's native controls (e.g. its circular send button) that one of
// our own injected buttons also happens to share a class with for visual
// consistency (see features/toolbar.js), so "real vs. ours" needs to be
// disambiguated at runtime.
function isDeepBlueOwnedElement(el) {
  return !!(el && el.id && el.id.startsWith('deepblue-'));
}

// "1 message" vs "3 messages" - small, but avoids grammatically-off text
// showing up in generated PDFs and other user-facing surfaces.
function pluralize(count, noun, pluralNoun) {
  return count === 1 ? `1 ${noun}` : `${count} ${pluralNoun || noun + 's'}`;
}

// Small FNV-1a style hash - not cryptographic, just good enough to turn a
// message's text into a short, stable-ish key so we can recognize the
// "same" message again later without DeepSeek exposing a real message id.
function hashText(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Converts a rendered message's DOM (DeepSeek renders markdown into real
// <strong>/<em>/<code>/<table>/etc. elements client-side, not raw markdown
// text) into clean plain text: no **, #, `, |, or other markdown syntax,
// just readable text with sensible line breaks, "- " bullets, numbered
// list items, and "label (url)" for links.
function htmlNodeToPlainText(root) {
  let out = '';

  function walkChildren(node) {
    for (const child of node.childNodes) walk(child);
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    switch (node.tagName) {
      case 'BR':
        out += '\n';
        return;
      case 'HR':
        out += '\n\n';
        return;
      case 'IMG':
        return;

      case 'PRE': {
        const codeEl = node.querySelector('code') || node;
        out += '\n' + codeEl.textContent.replace(/\s+$/, '') + '\n\n';
        return;
      }

      // Only reached for INLINE code - a <pre><code> block returns early
      // above and never walks into its own <code> child.
      case 'CODE':
        out += node.textContent;
        return;

      case 'A': {
        const before = out.length;
        walkChildren(node);
        const label = out.slice(before).trim();
        const href = node.getAttribute('href');
        if (href && href !== label && !href.startsWith('#')) {
          out = out.slice(0, before) + label + ` (${href})`;
        }
        return;
      }

      case 'LI': {
        const parentTag = node.parentElement?.tagName;
        if (parentTag === 'OL') {
          const index = Array.prototype.indexOf.call(node.parentElement.children, node) + 1;
          out += `${index}. `;
        } else {
          out += '- ';
        }
        walkChildren(node);
        out += '\n';
        return;
      }

      case 'TABLE': {
        node.querySelectorAll('tr').forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent.trim());
          out += cells.join('  |  ') + '\n';
        });
        out += '\n';
        return;
      }

      case 'UL':
      case 'OL':
        // Element children only (i.e. the <li>s) - a whitespace-only text
        // node between list items in the source markup shouldn't turn into
        // a spurious blank line in the copied text.
        Array.from(node.children).forEach((li) => walk(li));
        out += '\n';
        return;

      case 'P':
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
      case 'DIV':
      case 'BLOCKQUOTE':
        walkChildren(node);
        out += '\n\n';
        return;

      default:
        walkChildren(node);
        return;
    }
  }

  walkChildren(root);
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
