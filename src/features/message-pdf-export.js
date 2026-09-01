// features/message-pdf-export.js - adds a "download this response as PDF"
// button to each assistant response's action row, right next to the
// "copy without markdown" button added by copy-plain.js.
//
// Clicking it exports just that one exchange - the assistant's response
// plus the user message that prompted it - as a standalone PDF, reusing
// the same extraction/render/PDF pipeline as the full-conversation export
// (pdf/extractor.js + pdf/renderer.js + pdf/pdf-export.js) rather than
// building a second document pipeline.
//
// Depends on: config.js, dom.js, utils.js (queryFirst, sanitizeFilename),
// pdf/extractor.js (Extractor), pdf/pdf-export.js (PdfExport). Must be
// loaded AFTER copy-plain.js (so its button can anchor off
// .deepblue-copy-plain-btn) and AFTER src/pdf/pdf-export.js in
// manifest.json's content_scripts[].js array.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const MessagePdfExport = {
  _processed: new WeakSet(),

  scan() {
    try {
      const messages = Array.from(DOM.findMessages());
      messages.forEach((message, index) => this._processMessage(message, index, messages));
    } catch (err) {
      console.debug(`${BRAND_NAME}: per-response PDF export error`, err);
    }
  },

  _isAssistantMessage(message) {
    const looksLikeUser =
      message.classList.contains('d29f3d7d') ||
      message.querySelector(CONFIG.selectors.userMessageMarker) !== null;
    return !looksLikeUser;
  },

  _processMessage(message, index, allMessages) {
    if (this._processed.has(message)) return;
    if (message.querySelector('.deepblue-msg-pdf-btn')) {
      this._processed.add(message);
      return;
    }
    if (!this._isAssistantMessage(message)) return;

    const markdown = message.querySelector(CONFIG.selectors.markdown);
    if (!markdown) return;

    const actionRow = queryFirst(
      CONFIG.selectors.messageActionRow,
      message.parentElement || document
    );
    const buttonRow = actionRow ? queryFirst(CONFIG.selectors.messageButtonRow, actionRow) : null;
    if (!buttonRow) return;

    // Sit immediately after the "copy without markdown" button when it's
    // there (this is the requested placement); otherwise fall back to the
    // same anchor copy-plain.js itself uses, so the button still appears
    // in a sensible spot if copy-plain.js is ever removed/reordered.
    const copyPlainBtn = buttonRow.querySelector('.deepblue-copy-plain-btn');
    const anchor = copyPlainBtn
      ? copyPlainBtn.nextSibling
      : buttonRow.querySelector(CONFIG.selectors.shareButton) || buttonRow.lastElementChild || null;

    buttonRow.insertBefore(this._buildButton(message), anchor);
    this._processed.add(message);
  },

  // Walks backward from `fromIndex` (exclusive) over the live message list
  // to find the nearest preceding user turn - i.e. the prompt that this
  // assistant response answers.
  _findPrecedingUserMessage(fromIndex, allMessages) {
    for (let i = fromIndex - 1; i >= 0; i--) {
      const candidate = allMessages[i];
      if (candidate && !this._isAssistantMessage(candidate)) return candidate;
    }
    return null;
  },

  _buildButton(assistantMessage) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deepblue-msg-pdf-btn';
    btn.title = 'Download this response as PDF';
    btn.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 50%; border: none; background: none;
    color: #6c6c72; cursor: pointer; padding: 0; margin-left: 2px; flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
    `;
    btn.innerHTML = this._icon();

    btn.addEventListener('mouseenter', () => {
      if (btn.disabled) return;
      btn.style.background = '#f0f1f4';
      btn.style.color = '#1d1d1f';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
      btn.style.color = '#6c6c72';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._export(assistantMessage, btn);
    });

    return btn;
  },

  async _export(assistantMessage, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.style.cursor = 'default';
    const spinning = this._spinIcon();
    btn.innerHTML = spinning;

    try {
      const markdown = assistantMessage.querySelector(CONFIG.selectors.markdown);
      if (!markdown) {
        alert('Could not read this response. Please try again.');
        this._flash(btn, false);
        return;
      }

      // Re-read the live message list at click time (not scan time) so
      // the index is correct even if messages were added/removed since.
      const liveMessages = Array.from(DOM.findMessages());
      const index = liveMessages.indexOf(assistantMessage);
      const userMessage = this._findPrecedingUserMessage(
        index === -1 ? liveMessages.length : index,
        liveMessages
      );

      const conversationMessages = [];
      let promptSnippet = '';
      if (userMessage) {
        const text =
          userMessage.querySelector(CONFIG.selectors.userMessageMarker)?.textContent?.trim() || '';
        if (text) {
          conversationMessages.push({ role: 'user', content: text, isHTML: false });
          promptSnippet = text;
        }
      }
      conversationMessages.push({
        role: 'assistant',
        content: Extractor._renderNodeChildren(markdown),
        isHTML: true,
      });

      const chatTitle = DOM.findConversationTitle();
      const conversation = { title: chatTitle, messages: conversationMessages };
      const filename = sanitizeFilename(promptSnippet || chatTitle) + '-response';

      const ok = await PdfExport.exportMessages(conversation, filename);
      this._flash(btn, ok !== false);
    } catch (err) {
      console.error(`${BRAND_NAME}: per-response export failed`, err);
      alert('Failed to export this response. Please try again.');
      this._flash(btn, false);
    } finally {
      btn.disabled = false;
      btn.style.cursor = 'pointer';
    }
  },

  _flash(btn, success) {
    btn.innerHTML = success ? this._checkIcon() : this._icon();
    btn.title = success ? 'Downloaded!' : 'Download this response as PDF';
    setTimeout(() => {
      btn.innerHTML = this._icon();
      btn.title = 'Download this response as PDF';
    }, 1200);
  },

  _icon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 19.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    `;
  },

  _spinIcon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" stroke-opacity="0.25"/>
    <path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite"/>
    </path>
    </svg>
    `;
  },

  _checkIcon() {
    return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 13l4 4L19 7" stroke="#22c55e" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    `;
  },
};
