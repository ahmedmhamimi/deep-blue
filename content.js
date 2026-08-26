// content.js - DeepBlue: Export DeepSeek Conversation as PDF (direct save, no print dialog)

(function() {
  'use strict';

  const BRAND_NAME = 'DeepBlue';

  // Wait for the page to fully load
  window.addEventListener('load', function() {
    setTimeout(addButtons, 1500);
  });

  // Also watch for DOM changes in case the UI loads dynamically
  const observer = new MutationObserver(function(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' || mutation.type === 'subtree') {
        const attachButton = findAttachButton();
        if (attachButton) {
          const exportButton = document.getElementById('deepblue-export-pdf-btn');
          const counter = document.getElementById('deepblue-char-counter');
          if (!exportButton || !counter) {
            addButtons();
          }
          break;
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Function to find the attach/clip button container
  function findAttachButton() {
    const fileInput = document.querySelector('input[type="file"][multiple]');
    if (fileInput) {
      const parent = fileInput.closest('.bf38813a') || fileInput.parentElement;
      if (parent) {
        const buttonContainer = parent.querySelector('div[style*="width: fit-content"]') ||
        parent.querySelector('.ds-button.ds-button--primary')?.closest('div[style*="width: fit-content"]');
        if (buttonContainer) {
          return buttonContainer;
        }
        return parent;
      }
    }
    return null;
  }

  // Function to find the textarea input
  function findTextarea() {
    return document.querySelector('textarea._27c9245, textarea[placeholder*="Message DeepSeek"]');
  }

  // Function to update character count
  function updateCharCount(textarea) {
    if (!textarea) return;

    const countSpan = document.getElementById('deepblue-char-count');
    const counter = document.getElementById('deepblue-char-counter');
    if (!countSpan || !counter) return;

    const count = textarea.value.length;
    countSpan.textContent = count;

    // Color coding based on character count
    if (count > 1000) {
      counter.style.color = '#ff6b6b';
    } else if (count > 500) {
      counter.style.color = '#feca57';
    } else {
      counter.style.color = '#8e8e93';
    }
  }

  // Combined function to add both buttons in correct order
  function addButtons() {
    // Don't add duplicates
    if (document.getElementById('deepblue-export-pdf-btn') && document.getElementById('deepblue-char-counter')) {
      return;
    }

    const attachButtonContainer = findAttachButton();
    if (!attachButtonContainer) {
      return;
    }

    // Get the parent container (this is the ec4f5d61 div)
    const parentContainer = attachButtonContainer.parentNode;

    // Create export button
    const exportBtn = document.createElement('div');
    exportBtn.id = 'deepblue-export-pdf-btn';
    exportBtn.setAttribute('role', 'button');
    exportBtn.setAttribute('tabindex', '0');
    exportBtn.className = 'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m';
    exportBtn.style.cssText = '--dsl-button-height: 34px; cursor: pointer; flex-shrink: 0; margin-right: 4px;';
    exportBtn.title = `Export conversation as PDF (${BRAND_NAME})`;
    exportBtn.innerHTML = `
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 20H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 4V16M12 16L8 12M12 16L16 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 16H20V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V16Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    </div>
    `;
    exportBtn.addEventListener('click', exportConversationAsPDF);

    // Create character counter
    const counter = document.createElement('div');
    counter.id = 'deepblue-char-counter';
    counter.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 700;
    color: #8e8e93;
    padding: 0 6px 0 4px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    user-select: none;
    flex-shrink: 0;
    height: 34px;
    letter-spacing: 0.2px;
    `;
    counter.innerHTML = `<span id="deepblue-char-count">0</span><span>characters</span>`;
    counter.title = 'Character count';

    // Insert export button before attach button
    if (exportBtn && !document.getElementById('deepblue-export-pdf-btn')) {
      parentContainer.insertBefore(exportBtn, attachButtonContainer);
    }

    // Insert counter before attach button (after export button)
    if (counter && !document.getElementById('deepblue-char-counter')) {
      parentContainer.insertBefore(counter, attachButtonContainer);
    }

    // Set up character counter with multiple event listeners
    const textarea = findTextarea();
    if (textarea) {
      // Initial update
      updateCharCount(textarea);

      // Listen for user input
      textarea.addEventListener('input', function() {
        updateCharCount(this);
      });

      textarea.addEventListener('change', function() {
        updateCharCount(this);
      });

      // Listen for programmatic changes (like when send clears the textarea)
      // Using MutationObserver to watch for value changes
      const textareaObserver = new MutationObserver(function(mutations) {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
            updateCharCount(textarea);
          }
        }
      });

      textareaObserver.observe(textarea, {
        attributes: true,
        attributeFilter: ['value']
      });

      // Also listen for the send button click to update after sending
      const sendButton = document.querySelector('.ds-button.ds-button--primary.ds-button--filled.ds-button--circle .ds-button__icon')?.closest('.ds-button');
      if (sendButton) {
        sendButton.addEventListener('click', function() {
          // Small delay to let the textarea clear
          setTimeout(() => {
            updateCharCount(textarea);
          }, 50);
        });
      }

      // Also watch for any click on the parent container that might trigger a send
      document.addEventListener('click', function(e) {
        // Check if click is on or inside the send button area
        const target = e.target;
        if (target.closest && target.closest('.ds-button.ds-button--primary.ds-button--filled.ds-button--circle')) {
          setTimeout(() => {
            updateCharCount(textarea);
          }, 50);
        }
      });
    }

    console.log(`${BRAND_NAME} Buttons added!`);
    console.log('Order: DeepThink/Search -> Export button -> Counter -> Clip button');
  }

  // Legacy function for backward compatibility
  function addExportButton() {
    addButtons();
  }

  function addCharacterCounter() {
    addButtons();
  }

  function setButtonLoading(isLoading) {
    const btn = document.getElementById('deepblue-export-pdf-btn');
    if (!btn) return;
    if (isLoading) {
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      btn.dataset.originalTitle = btn.title;
      btn.title = 'Generating PDF...';
    } else {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      if (btn.dataset.originalTitle) btn.title = btn.dataset.originalTitle;
    }
  }

  // Main function to export conversation as PDF - generates and saves immediately, no preview window
  async function exportConversationAsPDF() {
    try {
      setButtonLoading(true);

      const conversationData = extractConversation();

      if (!conversationData || conversationData.messages.length === 0) {
        alert('No conversation to export. Please start a chat first.');
        setButtonLoading(false);
        return;
      }

      await generateAndSavePDF(conversationData);

    } catch (error) {
      console.error('Error exporting conversation:', error);
      alert('Failed to export conversation. Please try again.');
    } finally {
      setButtonLoading(false);
    }
  }

  // ---------- Extraction (unchanged logic, only reads the DeepSeek page DOM) ----------

  function extractConversation() {
    const title = document.querySelector('.afa34042, .d00ed9c9')?.textContent?.trim() || 'DeepSeek Conversation';

    const messageContainers = document.querySelectorAll('.ds-message._63c77b1');

    if (messageContainers.length === 0) {
      const altContainers = document.querySelectorAll('[class*="ds-message"]');
      if (altContainers.length > 0) {
        return extractMessagesFromContainers(altContainers, title);
      }
      return { title, messages: [] };
    }

    return extractMessagesFromContainers(messageContainers, title);
  }

  function extractMessagesFromContainers(containers, title) {
    const messages = [];

    containers.forEach((container) => {
      let content = '';
      let role = 'user';

      const isUser = container.classList.contains('d29f3d7d') ||
      container.querySelector('.fbb737a4') !== null;

      if (isUser) {
        role = 'user';
        const userContent = container.querySelector('.fbb737a4');
        if (userContent) {
          content = userContent.textContent.trim();
        }
      } else {
        role = 'assistant';
        const markdown = container.querySelector('.ds-markdown');
        if (markdown) {
          content = extractFormattedContent(markdown);
        }
      }

      if (content) {
        messages.push({ role, content, isHTML: role === 'assistant' });
      }
    });

    return { title, messages };
  }

  function extractFormattedContent(markdownElement) {
    let html = '';
    const children = markdownElement.children;
    for (let i = 0; i < children.length; i++) {
      html += processNode(children[i]);
    }
    return html;
  }

  function processNode(node) {
    let html = '';
    const tag = node.tagName?.toLowerCase();

    if (tag === 'p') {
      html += `<p>${node.innerHTML}</p>`;
    } else if (tag === 'ul' || tag === 'ol') {
      const listTag = tag === 'ul' ? 'ul' : 'ol';
      html += `<${listTag}>`;
      const items = node.querySelectorAll('li');
      items.forEach(li => {
        html += `<li>${li.innerHTML}</li>`;
      });
      html += `</${listTag}>`;
    } else if (tag === 'pre') {
      const codeElement = node.querySelector('code');
      if (codeElement) {
        const codeContent = codeElement.textContent;
        const language = codeElement.className?.replace('language-', '') || '';
        html += `<div class="code-block">`;
        if (language) {
          html += `<div class="code-header">${escapeHtml(language)}</div>`;
        }
        html += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
        html += `</div>`;
      } else {
        html += `<div class="code-block"><pre><code>${escapeHtml(node.textContent)}</code></pre></div>`;
      }
    } else if (tag === 'code') {
      html += `<code class="inline-code">${escapeHtml(node.textContent)}</code>`;
    } else if (tag === 'div' && node.className?.includes('ds-markdown')) {
      html += extractFormattedContent(node);
    } else if (tag === 'span' || tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i') {
      html += `<${tag}>${node.innerHTML}</${tag}>`;
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      html += `<${tag}>${node.innerHTML}</${tag}>`;
    } else if (node.children && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) {
        html += processNode(node.children[i]);
      }
    } else if (node.textContent) {
      html += escapeHtml(node.textContent);
    }

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------- PDF generation: render real DOM blocks off-screen, snapshot each with   ----------
  // ---------- html2canvas, and lay the snapshots into a jsPDF document ourselves,     ----------
  // ---------- so a block never gets sliced through the middle and nothing is cut off. ----------

  const PAGE = {
    widthPt: 595.28,   // A4
    heightPt: 841.89,
    marginPt: 36,
  };
  const CONTENT_WIDTH_PX = 760; // width of the off-screen render container, in CSS px
  const RENDER_SCALE = 2;       // html2canvas scale for crisp text

  async function generateAndSavePDF(conversationData) {
    const stage = buildRenderStage(conversationData);
    document.body.appendChild(stage.root);

    // Let the browser lay everything out before we start snapshotting
    await nextFrame();

    const pdf = new window.jspdf.jsPDF({
      orientation: 'p',
      unit: 'pt',
      format: 'a4',
    });

    const contentWidthPt = PAGE.widthPt - PAGE.marginPt * 2;
    const pageContentHeightPt = PAGE.heightPt - PAGE.marginPt * 2;

    let cursorY = PAGE.marginPt;
    const blockSpacingPt = 10;

    try {
      for (const blockEl of stage.blocks) {
        const canvas = await html2canvas(blockEl, {
          scale: RENDER_SCALE,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        });

        const ratio = contentWidthPt / canvas.width;
        const blockHeightPt = canvas.height * ratio;

        if (blockHeightPt <= pageContentHeightPt) {
          // Whole block fits on one page - keep it intact, never split mid-block
          if (cursorY + blockHeightPt > PAGE.marginPt + pageContentHeightPt) {
            pdf.addPage();
            cursorY = PAGE.marginPt;
          }
          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          pdf.addImage(imgData, 'JPEG', PAGE.marginPt, cursorY, contentWidthPt, blockHeightPt);
          cursorY += blockHeightPt + blockSpacingPt;
        } else {
          // Block is taller than a full page (e.g. a huge code block) - slice it
          // at page boundaries so each slice still lands on a clean page break.
          const pxPerPage = pageContentHeightPt / ratio;
          let sy = 0;
          let first = true;
          while (sy < canvas.height) {
            const sliceHeightPx = Math.min(pxPerPage, canvas.height - sy);
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = sliceHeightPx;
            const ctx = sliceCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
            ctx.drawImage(canvas, 0, sy, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

            const sliceHeightPt = sliceHeightPx * ratio;

            if (!first || cursorY + sliceHeightPt > PAGE.marginPt + pageContentHeightPt) {
              pdf.addPage();
              cursorY = PAGE.marginPt;
            }

            const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
            pdf.addImage(sliceData, 'JPEG', PAGE.marginPt, cursorY, contentWidthPt, sliceHeightPt);
            cursorY += sliceHeightPt + blockSpacingPt;

            sy += sliceHeightPx;
            first = false;
          }
        }
      }
    } finally {
      document.body.removeChild(stage.root);
    }

    const filename = sanitizeFilename(conversationData.title) + '.pdf';
    pdf.save(filename); // triggers an immediate browser download - no print dialog, no preview window
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function sanitizeFilename(name) {
    return (name || 'DeepSeek-Conversation')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'DeepSeek-Conversation';
  }

  // Builds an off-screen DOM tree with the same visual styling the old print stylesheet used,
  // and returns it broken into discrete "blocks" (header, one per message, footer) so each can
  // be snapshotted and placed as an intact unit in the PDF.
  function buildRenderStage(conversationData) {
    const root = document.createElement('div');
    root.id = 'deepblue-pdf-render-stage';
    root.style.cssText = `
    position: fixed;
    top: 0;
    left: -100000px;
    width: ${CONTENT_WIDTH_PX}px;
    background: #ffffff;
    z-index: -1;
    `;

    const style = document.createElement('style');
    style.textContent = getStageCSS();
    root.appendChild(style);

    const blocks = [];
    const timestamp = new Date().toLocaleString();

    // Header block
    const header = document.createElement('div');
    header.className = 'db-header';
    header.innerHTML = `
    <div class="db-logo">◆ ${escapeHtml(BRAND_NAME)}</div>
    <h1 class="db-title">${escapeHtml(conversationData.title)}</h1>
    <div class="db-subtitle">Exported on ${escapeHtml(timestamp)} · ${conversationData.messages.length} messages</div>
    `;
    root.appendChild(header);
    blocks.push(header);

    // One block per message
    conversationData.messages.forEach((msg) => {
      const messageEl = document.createElement('div');
      messageEl.className = `db-message db-${msg.role}`;
      const bodyHtml = msg.isHTML ? msg.content : escapeHtml(msg.content).replace(/\n/g, '<br>');
      messageEl.innerHTML = `
      <div class="db-role-label"><span class="db-dot"></span>${msg.role === 'user' ? 'You' : 'DeepSeek'}</div>
      <div class="db-content">${bodyHtml}</div>
      `;
      root.appendChild(messageEl);
      blocks.push(messageEl);
    });

    // Footer block
    const footer = document.createElement('div');
    footer.className = 'db-footer';
    footer.innerHTML = `<span>Exported with <span class="db-brand">${escapeHtml(BRAND_NAME)}</span></span> · <span>${new Date().getFullYear()}</span>`;
    root.appendChild(footer);
    blocks.push(footer);

    return { root, blocks };
  }

  function getStageCSS() {
    return `
    #deepblue-pdf-render-stage, #deepblue-pdf-render-stage * {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1d1d1f;
    }

    #deepblue-pdf-render-stage .db-header {
    text-align: center;
    padding: 20px 24px 16px;
    border-bottom: 3px solid #3964fe;
    margin-bottom: 16px;
    }
    #deepblue-pdf-render-stage .db-logo {
    font-size: 26px;
    font-weight: 700;
    color: #3964fe;
    letter-spacing: -0.5px;
    }
    #deepblue-pdf-render-stage .db-title {
    font-size: 17px;
    font-weight: 500;
    margin: 6px 0 3px;
    }
    #deepblue-pdf-render-stage .db-subtitle {
    font-size: 12px;
    color: #8e8e93;
    }

    #deepblue-pdf-render-stage .db-message {
    margin: 0 4px 14px;
    padding: 14px 20px;
    border-radius: 10px;
    border: 1px solid #e9ecf0;
    }
    #deepblue-pdf-render-stage .db-message.db-user {
    background: #f0f7ff;
    border-color: #d0e0ff;
    border-left: 4px solid #3964fe;
    }
    #deepblue-pdf-render-stage .db-message.db-assistant {
    background: #f8f9fb;
    border-color: #e9ecf0;
    border-right: 4px solid #6c5ce7;
    }
    #deepblue-pdf-render-stage .db-role-label {
    font-size: 11px;
    font-weight: 700;
    color: #8e8e93;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 6px;
    }
    #deepblue-pdf-render-stage .db-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    background: currentColor;
    }
    #deepblue-pdf-render-stage .db-user .db-dot { background: #3964fe; }
    #deepblue-pdf-render-stage .db-assistant .db-dot { background: #6c5ce7; }

    #deepblue-pdf-render-stage .db-content {
    font-size: 14px;
    line-height: 1.6;
    }
    #deepblue-pdf-render-stage .db-content p { margin: 0 0 8px; }
    #deepblue-pdf-render-stage .db-content p:last-child { margin-bottom: 0; }
    #deepblue-pdf-render-stage .db-content ul,
    #deepblue-pdf-render-stage .db-content ol {
    padding-left: 22px;
    margin: 6px 0;
    }
    #deepblue-pdf-render-stage .db-content li { margin-bottom: 4px; }
    #deepblue-pdf-render-stage .db-content strong { font-weight: 600; }
    #deepblue-pdf-render-stage .db-content em { font-style: italic; }
    #deepblue-pdf-render-stage .db-content h1,
    #deepblue-pdf-render-stage .db-content h2,
    #deepblue-pdf-render-stage .db-content h3 {
    margin: 10px 0 6px;
    font-weight: 600;
    }
    #deepblue-pdf-render-stage .db-content h1 { font-size: 19px; }
    #deepblue-pdf-render-stage .db-content h2 { font-size: 17px; }
    #deepblue-pdf-render-stage .db-content h3 { font-size: 15px; }

    #deepblue-pdf-render-stage .code-block {
    background: #1e1e2e;
    border-radius: 8px;
    margin: 10px 0;
    overflow: hidden;
    }
    #deepblue-pdf-render-stage .code-header {
    background: #2d2d44;
    color: #cdd6f4;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 14px;
    font-family: 'Menlo', 'Consolas', monospace;
    border-bottom: 1px solid #3d3d55;
    }
    #deepblue-pdf-render-stage .code-block pre {
    margin: 0;
    padding: 12px 16px;
    white-space: pre-wrap;
    word-wrap: break-word;
    background: #1e1e2e;
    }
    #deepblue-pdf-render-stage .code-block code {
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #cdd6f4;
    white-space: pre-wrap;
    word-wrap: break-word;
    }
    #deepblue-pdf-render-stage .inline-code {
    background: #f0f0f5;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 13px;
    color: #d63384;
    border: 1px solid #e5e5ea;
    }

    #deepblue-pdf-render-stage .db-footer {
    text-align: center;
    padding: 14px 0 6px;
    margin-top: 6px;
    border-top: 2px solid #e9ecf0;
    font-size: 11px;
    color: #8e8e93;
    }
    #deepblue-pdf-render-stage .db-brand {
    color: #3964fe;
    font-weight: 500;
    }
    `;
  }

  console.log(`${BRAND_NAME} Export PDF extension loaded!`);
})();
