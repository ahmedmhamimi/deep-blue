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
