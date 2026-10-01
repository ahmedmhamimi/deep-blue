// pdf/pdf-export.js - orchestrates extraction, off-screen render, and jsPDF assembly.
//
// Depends on: config.js, dom.js, utils.js, features/toolbar.js (Toolbar,
// for loading state), export/loading-overlay.js (LoadingOverlay - shows a
// visible "generating your PDF" pill for the duration, since this path -
// unlike JSON/text export - can genuinely take a few seconds), pdf/extractor.js
// (Extractor), pdf/renderer.js (Renderer), and the vendor libs html2canvas
// / jspdf loaded before it.
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
    LoadingOverlay.show(Lang.t('loading.pdf.whole'));

    try {
      if (!window.jspdf?.jsPDF || typeof window.html2canvas !== 'function') {
        alert(Lang.t('pdf.engineLoadFailed'));
        LoadingOverlay.finish(false, Lang.t('loading.pdf.engineFail'));
        return;
      }

      const conversation = Extractor.extract();
      if (!conversation || conversation.messages.length === 0) {
        alert(Lang.t('download.noConversation'));
        LoadingOverlay.hide();
        return;
      }

      await PdfExport._generate(conversation);
      LoadingOverlay.finish(true, Lang.t('loading.pdf.downloaded'));
    } catch (err) {
      console.error(`${BRAND_NAME}: export failed`, err);
      alert(Lang.t('download.failed'));
      LoadingOverlay.finish(false, Lang.t('loading.pdf.failed'));
    } finally {
      Toolbar.setExportButtonLoading(false);
      PdfExport._running = false;
    }
  },

  // Same generation pipeline as run(), but for a caller-supplied
  // conversation (e.g. a single user/assistant pair) instead of the whole
  // extracted chat, and with its own filename. Shares the `_running` guard
  // with run() so a per-message export and a full-conversation export
  // never rasterize into the same off-screen #${CONFIG.ids.renderStage}
  // node at the same time.
  async exportMessages(conversation, filename) {
    if (PdfExport._running) {
      alert(Lang.t('pdf.inProgress'));
      return false;
    }
    if (!window.jspdf?.jsPDF || typeof window.html2canvas !== 'function') {
      alert(Lang.t('pdf.engineLoadFailed'));
      return false;
    }
    if (!conversation || conversation.messages.length === 0) {
      alert(Lang.t('export.nothing'));
      return false;
    }

    PdfExport._running = true;
    LoadingOverlay.show(Lang.t('loading.pdf.message'));
    try {
      await PdfExport._generate(conversation, filename);
      LoadingOverlay.finish(true, Lang.t('loading.pdf.downloaded'));
      return true;
    } catch (err) {
      LoadingOverlay.finish(false, Lang.t('loading.pdf.failed'));
      throw err;
    } finally {
      PdfExport._running = false;
    }
  },

  async _generate(conversation, filenameOverride) {
    const { root, blocks } = Renderer.buildStage(conversation);
    document.body.appendChild(root);

    try {
      await nextFrame();

      const { pageWidthPt, pageHeightPt, marginPt, renderScale, jpegQuality, blockSpacingPt } =
        CONFIG.pdf;
      const contentWidthPt = pageWidthPt - marginPt * 2;
      const pageContentHeightPt = pageHeightPt - marginPt * 2;

      // Measure where each message block sits, in CSS px, BEFORE rasterizing.
      // This is just reading layout the browser already computed - cheap -
      // and lets us find page-break points without needing a separate
      // html2canvas call per block. (That was the actual slowness: each
      // html2canvas() call re-parses the page's stylesheets and clones a
      // render tree regardless of how small the block is, so N calls cost
      // roughly N times the fixed overhead, not just N times the pixel
      // work. For a long conversation that overhead dominates.)
      const rootTop = root.getBoundingClientRect().top;
      const blockRects = blocks.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - rootTop, height: r.height };
      });

      // One rasterization pass for the whole conversation instead of one
      // per message.
      const fullCanvas = await html2canvas(root, {
        scale: renderScale,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      if (!fullCanvas.width || !fullCanvas.height) {
        throw new Error('PDF render stage produced an empty canvas');
      }

      const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      const ptPerCanvasPx = contentWidthPt / fullCanvas.width;

      let cursorY = marginPt;

      for (const rect of blockRects) {
        const topPx = rect.top * renderScale;
        const heightPx = rect.height * renderScale;
        if (heightPx <= 0) continue;

        const blockHeightPt = heightPx * ptPerCanvasPx;

        if (blockHeightPt <= pageContentHeightPt) {
          if (cursorY + blockHeightPt > marginPt + pageContentHeightPt) {
            pdf.addPage();
            cursorY = marginPt;
          }
          PdfExport._drawCanvasSlice(
            pdf,
            fullCanvas,
            topPx,
            heightPx,
            marginPt,
            cursorY,
            contentWidthPt,
            blockHeightPt,
            jpegQuality
          );
          cursorY += blockHeightPt + blockSpacingPt;
        } else {
          cursorY = PdfExport._addSlicedBlock(
            pdf,
            fullCanvas,
            topPx,
            heightPx,
            ptPerCanvasPx,
            cursorY,
            contentWidthPt,
            pageContentHeightPt,
            marginPt,
            jpegQuality,
            blockSpacingPt
          );
        }
      }

      pdf.save((filenameOverride || sanitizeFilename(conversation.title)) + '.pdf');
    } finally {
      root.remove();
    }
  },

  // Crops [srcTopPx, srcTopPx + srcHeightPx) out of the master canvas and
  // draws it into the PDF at the given position, without re-rendering
  // anything.
  _drawCanvasSlice(pdf, srcCanvas, srcTopPx, srcHeightPx, x, y, widthPt, heightPt, jpegQuality) {
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = srcCanvas.width;
    sliceCanvas.height = Math.max(1, Math.round(srcHeightPx));
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      srcCanvas,
      0,
      srcTopPx,
      srcCanvas.width,
      srcHeightPx,
      0,
      0,
      srcCanvas.width,
      srcHeightPx
    );
    pdf.addImage(sliceCanvas.toDataURL('image/jpeg', jpegQuality), 'JPEG', x, y, widthPt, heightPt);
  },

  // Same idea as the original per-block slicer, but sources every slice
  // from a region of the single master canvas instead of rasterizing a
  // fresh one, for blocks too tall to fit on one page.
  _addSlicedBlock(
    pdf,
    srcCanvas,
    blockTopPx,
    blockHeightPx,
    ptPerCanvasPx,
    cursorY,
    contentWidthPt,
    pageContentHeightPt,
    marginPt,
    jpegQuality,
    blockSpacingPt
  ) {
    const pxPerPage = pageContentHeightPt / ptPerCanvasPx;
    let sy = 0;
    let first = true;

    while (sy < blockHeightPx) {
      const sliceHeightPx = Math.min(pxPerPage, blockHeightPx - sy);
      const sliceHeightPt = sliceHeightPx * ptPerCanvasPx;

      if (!first || cursorY + sliceHeightPt > marginPt + pageContentHeightPt) {
        pdf.addPage();
        cursorY = marginPt;
      }
      PdfExport._drawCanvasSlice(
        pdf,
        srcCanvas,
        blockTopPx + sy,
        sliceHeightPx,
        marginPt,
        cursorY,
        contentWidthPt,
        sliceHeightPt,
        jpegQuality
      );
      cursorY += sliceHeightPt + blockSpacingPt;
      sy += sliceHeightPx;
      first = false;
    }
    return cursorY;
  },
};
