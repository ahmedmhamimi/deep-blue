// pdf/pdf-export.js - orchestrates extraction, off-screen render, and jsPDF assembly.
//
// Depends on: config.js, dom.js, utils.js, features/toolbar.js (Toolbar,
// for loading state), pdf/extractor.js (Extractor), pdf/renderer.js
// (Renderer), and the vendor libs html2canvas / jspdf loaded before it.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const PdfExport = {
  _running: false,

  async run() {
    if (PdfExport._running) return;
    PdfExport._running = true;
    Toolbar.setExportButtonLoading(true);

    try {
      if (!window.jspdf?.jsPDF || typeof window.html2canvas !== 'function') {
        alert(`${BRAND_NAME} could not load its PDF engine. Try reloading the page.`);
        return;
      }

      const conversation = Extractor.extract();
      if (!conversation || conversation.messages.length === 0) {
        alert('No conversation to export. Please start a chat first.');
        return;
      }

      await PdfExport._generate(conversation);
    } catch (err) {
      console.error(`${BRAND_NAME}: export failed`, err);
      alert('Failed to export conversation. Please try again.');
    } finally {
      Toolbar.setExportButtonLoading(false);
      PdfExport._running = false;
    }
  },

  async _generate(conversation) {
    const { root, blocks } = Renderer.buildStage(conversation);
    document.body.appendChild(root);

    try {
      await nextFrame();

      const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      const { pageWidthPt, pageHeightPt, marginPt, renderScale, jpegQuality, blockSpacingPt } =
        CONFIG.pdf;
      const contentWidthPt = pageWidthPt - marginPt * 2;
      const pageContentHeightPt = pageHeightPt - marginPt * 2;

      let cursorY = marginPt;

      for (const blockEl of blocks) {
        const canvas = await html2canvas(blockEl, {
          scale: renderScale,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        });
        if (!canvas.width || !canvas.height) continue;

        const ratio = contentWidthPt / canvas.width;
        const blockHeightPt = canvas.height * ratio;

        if (blockHeightPt <= pageContentHeightPt) {
          if (cursorY + blockHeightPt > marginPt + pageContentHeightPt) {
            pdf.addPage();
            cursorY = marginPt;
          }
          pdf.addImage(
            canvas.toDataURL('image/jpeg', jpegQuality),
            'JPEG',
            marginPt,
            cursorY,
            contentWidthPt,
            blockHeightPt
          );
          cursorY += blockHeightPt + blockSpacingPt;
        } else {
          cursorY = PdfExport._addSlicedBlock(
            pdf,
            canvas,
            ratio,
            cursorY,
            contentWidthPt,
            pageContentHeightPt,
            marginPt,
            jpegQuality,
            blockSpacingPt
          );
        }
      }

      pdf.save(sanitizeFilename(conversation.title) + '.pdf');
    } finally {
      root.remove();
    }
  },

  _addSlicedBlock(
    pdf,
    canvas,
    ratio,
    cursorY,
    contentWidthPt,
    pageContentHeightPt,
    marginPt,
    jpegQuality,
    blockSpacingPt
  ) {
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
      if (!first || cursorY + sliceHeightPt > marginPt + pageContentHeightPt) {
        pdf.addPage();
        cursorY = marginPt;
      }
      pdf.addImage(
        sliceCanvas.toDataURL('image/jpeg', jpegQuality),
        'JPEG',
        marginPt,
        cursorY,
        contentWidthPt,
        sliceHeightPt
      );
      cursorY += sliceHeightPt + blockSpacingPt;
      sy += sliceHeightPx;
      first = false;
    }
    return cursorY;
  },
};
