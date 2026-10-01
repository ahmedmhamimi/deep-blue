// export/format-export.js - turns a `conversation` object (the same
// { title, messages: [{role, content, isHTML}] } shape produced by
// pdf/extractor.js's Extractor.extract(), and reused as-is by
// features/message-pdf-export.js for a single exchange) into a JSON file
// or a plain-text file, and triggers the actual browser download.
//
// Kept separate from pdf/pdf-export.js on purpose: the PDF path needs
// html2canvas + jsPDF and an off-screen render stage, while this path is
// just string-building + a Blob, so neither pulls in machinery the other
// doesn't need.
//
// Depends on: utils.js (htmlNodeToPlainText, sanitizeFilename).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const FormatExport = {
  // Assistant messages carry sanitized HTML (built by Extractor for the
  // PDF renderer), not raw text - render it into a detached element and
  // reuse the same HTML -> plain-text walker copy-plain.js relies on, so
  // JSON/TXT output reads the same way "copy without markdown" does,
  // rather than dumping raw tags.
  _htmlSink: null,
  _htmlToText(html) {
    if (!this._htmlSink) this._htmlSink = document.createElement('div');
    this._htmlSink.innerHTML = html;
    return htmlNodeToPlainText(this._htmlSink);
  },

  _plainMessages(conversation) {
    return conversation.messages.map((m) => ({
      role: m.role,
      content: m.isHTML ? this._htmlToText(m.content) : (m.content || '').trim(),
    }));
  },

  toPlainText(conversation) {
    const title = conversation.title || 'Conversation';
    const lines = [title, '='.repeat(title.length), ''];

    this._plainMessages(conversation).forEach(({ role, content }) => {
      lines.push(role === 'user' ? 'You:' : 'Assistant:');
      lines.push(content || '(empty)');
      lines.push('');
    });

    return lines.join('\n').trim() + '\n';
  },

  toJSON(conversation) {
    const payload = {
      title: conversation.title || 'Conversation',
      exportedAt: new Date().toISOString(),
      messages: this._plainMessages(conversation),
    };
    return JSON.stringify(payload, null, 2);
  },

  // Builds a temporary object URL and clicks a throwaway <a download> - the
  // same mechanism jsPDF's own pdf.save() uses under the hood, just done by
  // hand here since there's no library wrapping it for plain text/JSON.
  downloadTextFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  // Shared entry point for both the whole-conversation and per-message
  // download flows: given a conversation + base filename (no extension)
  // and the format the person picked in DownloadMenu, produces and
  // downloads the right file. Returns false (instead of throwing) for an
  // empty conversation so callers can show their own message/UI state.
  downloadAs(conversation, baseFilename, format) {
    if (!conversation || !conversation.messages || !conversation.messages.length) return false;

    if (format === 'json') {
      this.downloadTextFile(this.toJSON(conversation), `${baseFilename}.json`, 'application/json');
    } else {
      this.downloadTextFile(this.toPlainText(conversation), `${baseFilename}.txt`, 'text/plain');
    }
    return true;
  },
};
