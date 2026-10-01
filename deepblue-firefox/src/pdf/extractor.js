// pdf/extractor.js - reads the live conversation DOM and converts each message's
//
// markdown into sanitized, semantic HTML ready for the PDF renderer.
// Depends on: config.js, dom.js, utils.js (escapeHtml).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Extractor = {
  extract() {
    const title = DOM.findConversationTitle();
    const containers = DOM.findMessages();
    if (!containers.length) return { title, messages: [] };

    const messages = [];
    containers.forEach((container) => {
      const isUser =
        container.classList.contains('d29f3d7d') ||
        container.querySelector(CONFIG.selectors.userMessageMarker) !== null;

      let content = '';
      if (isUser) {
        content =
          container.querySelector(CONFIG.selectors.userMessageMarker)?.textContent?.trim() || '';
      } else {
        const markdown = container.querySelector(CONFIG.selectors.markdown);
        if (markdown) content = this._renderNodeChildren(markdown);
      }

      if (content) messages.push({ role: isUser ? 'user' : 'assistant', content, isHTML: !isUser });
    });

    return { title, messages };
  },

  _renderNodeChildren(el) {
    let html = '';
    for (const child of el.children) html += this._renderNode(child);
    return html;
  },

  _renderNode(node) {
    const tag = node.tagName?.toLowerCase();

    switch (tag) {
      case 'p':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'strong':
      case 'b':
      case 'em':
      case 'i':
      case 'span':
        return `<${tag}>${node.innerHTML}</${tag}>`;

      case 'br':
        return '<br>';
      case 'hr':
        return '<hr>';

      case 'a': {
        const href = node.getAttribute('href') || '';
        return `<a href="${escapeHtml(href)}">${node.innerHTML}</a>`;
      }

      case 'blockquote':
        return `<blockquote>${this._renderNodeChildren(node)}</blockquote>`;

      case 'ul':
      case 'ol': {
        let inner = '';
        node.querySelectorAll(':scope > li').forEach((li) => {
          inner += `<li>${li.innerHTML}</li>`;
        });
        return `<${tag}>${inner}</${tag}>`;
      }

      case 'table': {
        let rows = '';
        node.querySelectorAll('tr').forEach((tr) => {
          let cells = '';
          tr.querySelectorAll('th, td').forEach((cell) => {
            const cellTag = cell.tagName.toLowerCase();
            cells += `<${cellTag}>${cell.innerHTML}</${cellTag}>`;
          });
          rows += `<tr>${cells}</tr>`;
        });
        return `<table>${rows}</table>`;
      }

      case 'pre': {
        const codeEl = node.querySelector('code');
        const codeText = (codeEl || node).textContent;
        const language = codeEl?.className?.replace('language-', '').trim();
        return (
          `<div class="code-block">` +
          (language ? `<div class="code-header">${escapeHtml(language)}</div>` : '') +
          `<pre><code>${escapeHtml(codeText)}</code></pre></div>`
        );
      }

      case 'code':
        return `<code class="inline-code">${escapeHtml(node.textContent)}</code>`;

      case 'img':
        return '';

      case 'div':
        if (node.className?.includes('ds-markdown')) return this._renderNodeChildren(node);
      default:
        if (node.children?.length) {
          let out = '';
          for (const child of node.children) out += this._renderNode(child);
          return out;
        }
        return node.textContent ? escapeHtml(node.textContent) : '';
    }
  },
};
