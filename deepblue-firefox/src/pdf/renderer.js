// pdf/renderer.js - builds the off-screen, styled DOM stage that html2canvas
//
// rasterizes for the PDF. Pure DOM/CSS construction, no page interaction.
// Depends on: config.js, utils.js (escapeHtml).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Renderer = {
  buildStage(conversation) {
    const root = document.createElement('div');
    root.id = CONFIG.ids.renderStage;
    root.style.cssText = `
    position: fixed;
    top: 0;
    left: -100000px;
    width: ${CONFIG.pdf.contentWidthPx}px;
    background: #ffffff;
    z-index: -1;
    `;

    const style = document.createElement('style');
    style.textContent = this._css();
    root.appendChild(style);

    const blocks = [];
    const timestamp = new Date().toLocaleString();

    const header = document.createElement('div');
    header.className = 'db-header';
    header.innerHTML = `
    <div class="db-logo">${escapeHtml(BRAND_NAME)}</div>
    <h1 class="db-title">${escapeHtml(conversation.title)}</h1>
    <div class="db-subtitle">Exported on ${escapeHtml(timestamp)} - ${pluralize(conversation.messages.length, 'message')}</div>
    `;
    root.appendChild(header);
    blocks.push(header);

    conversation.messages.forEach((msg) => {
      const el = document.createElement('div');
      el.className = `db-message db-${msg.role}`;
      const body = msg.isHTML
        ? msg.content
        : `<p>${escapeHtml(msg.content).replace(/\n/g, '<br>')}</p>`;
      el.innerHTML = `
      <div class="db-role-label"><span class="db-dot"></span>${msg.role === 'user' ? 'You' : 'DeepSeek'}</div>
      <div class="db-content">${body}</div>
      `;
      root.appendChild(el);
      blocks.push(el);
    });

    const footer = document.createElement('div');
    footer.className = 'db-footer';
    footer.innerHTML = `<span>Exported with <span class="db-brand">${escapeHtml(BRAND_NAME)}</span></span> - <span>${new Date().getFullYear()}</span>`;
    root.appendChild(footer);
    blocks.push(footer);

    return { root, blocks };
  },

  _css() {
    return `
    #${CONFIG.ids.renderStage}, #${CONFIG.ids.renderStage} * {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1d1d1f;
    }
    #${CONFIG.ids.renderStage} .db-header { text-align: center; padding: 20px 24px 16px; border-bottom: 3px solid #3964fe; margin-bottom: 16px; }
    #${CONFIG.ids.renderStage} .db-logo { font-size: 26px; font-weight: 700; color: #3964fe; letter-spacing: -0.5px; }
    #${CONFIG.ids.renderStage} .db-title { font-size: 17px; font-weight: 500; margin: 6px 0 3px; word-break: break-word; }
    #${CONFIG.ids.renderStage} .db-subtitle { font-size: 12px; color: #8e8e93; }

    #${CONFIG.ids.renderStage} .db-message { margin: 0 4px 14px; padding: 14px 20px; border-radius: 10px; border: 1px solid #e9ecf0; }
    #${CONFIG.ids.renderStage} .db-message.db-user { background: #f0f7ff; border-color: #d0e0ff; border-left: 4px solid #3964fe; }
    #${CONFIG.ids.renderStage} .db-message.db-assistant { background: #f8f9fb; border-color: #e9ecf0; border-right: 4px solid #6c5ce7; }
    #${CONFIG.ids.renderStage} .db-role-label { font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
    #${CONFIG.ids.renderStage} .db-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: currentColor; }
    #${CONFIG.ids.renderStage} .db-user .db-dot { background: #3964fe; }
    #${CONFIG.ids.renderStage} .db-assistant .db-dot { background: #6c5ce7; }

    #${CONFIG.ids.renderStage} .db-content { font-size: 14px; line-height: 1.6; word-wrap: break-word; }
    #${CONFIG.ids.renderStage} .db-content p { margin: 0 0 8px; }
    #${CONFIG.ids.renderStage} .db-content p:last-child { margin-bottom: 0; }
    #${CONFIG.ids.renderStage} .db-content ul, #${CONFIG.ids.renderStage} .db-content ol { padding-left: 22px; margin: 6px 0; }
    #${CONFIG.ids.renderStage} .db-content li { margin-bottom: 4px; }
    #${CONFIG.ids.renderStage} .db-content strong { font-weight: 600; }
    #${CONFIG.ids.renderStage} .db-content em { font-style: italic; }
    #${CONFIG.ids.renderStage} .db-content a { color: #3964fe; text-decoration: underline; word-break: break-all; }
    #${CONFIG.ids.renderStage} .db-content blockquote { margin: 8px 0; padding: 4px 14px; border-left: 3px solid #d0d5dd; color: #4b5563; }
    #${CONFIG.ids.renderStage} .db-content h1, #${CONFIG.ids.renderStage} .db-content h2, #${CONFIG.ids.renderStage} .db-content h3 { margin: 10px 0 6px; font-weight: 600; }
    #${CONFIG.ids.renderStage} .db-content h1 { font-size: 19px; }
    #${CONFIG.ids.renderStage} .db-content h2 { font-size: 17px; }
    #${CONFIG.ids.renderStage} .db-content h3 { font-size: 15px; }
    #${CONFIG.ids.renderStage} .db-content table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
    #${CONFIG.ids.renderStage} .db-content th, #${CONFIG.ids.renderStage} .db-content td { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; }
    #${CONFIG.ids.renderStage} .db-content th { background: #f3f4f6; font-weight: 600; }

    #${CONFIG.ids.renderStage} .code-block { background: #1e1e2e; border-radius: 8px; margin: 10px 0; overflow: hidden; }
    #${CONFIG.ids.renderStage} .code-header { background: #2d2d44; color: #cdd6f4; font-size: 11px; font-weight: 500; padding: 4px 14px; font-family: 'Menlo', 'Consolas', monospace; border-bottom: 1px solid #3d3d55; }
    #${CONFIG.ids.renderStage} .code-block pre { margin: 0; padding: 12px 16px; white-space: pre-wrap; word-wrap: break-word; background: #1e1e2e; }
    #${CONFIG.ids.renderStage} .code-block code { font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; line-height: 1.5; color: #cdd6f4; white-space: pre-wrap; word-wrap: break-word; }
    #${CONFIG.ids.renderStage} .inline-code { background: #f0f0f5; padding: 1px 6px; border-radius: 3px; font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; color: #d63384; border: 1px solid #e5e5ea; }

    #${CONFIG.ids.renderStage} .db-footer { text-align: center; padding: 14px 0 6px; margin-top: 6px; border-top: 2px solid #e9ecf0; font-size: 11px; color: #8e8e93; }
    #${CONFIG.ids.renderStage} .db-brand { color: #3964fe; font-weight: 500; }
    `;
  },
};
