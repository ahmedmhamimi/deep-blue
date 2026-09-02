// features/context-meter.js - context-window usage progress bar UI.
//
// Depends on: config.js, dom.js, bridge-client.js, features/context-estimator.js.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const ContextMeter = {
  ensureInjected() {
    if (document.getElementById(CONFIG.ids.contextMeter)) return;

    // Preferred spot: next to the DeepThink/Search mode toggles. But that
    // row is located by searching for a "Search" toggle, which DeepSeek
    // hides while a chat is active in Expert/DeepThink mode. That made the
    // meter vanish for good the moment a message was sent in that mode,
    // since it could never be re-anchored after DeepSeek re-rendered the
    // composer. Fall back to the same send-button toolbar the char counter
    // and export button use - it always exists, regardless of mode.
    const row = DOM.findComposerModeRow();
    if (row) {
      row.appendChild(this._build());
      return;
    }

    const sendWrapper = DOM.findSendButtonWrapper();
    const toolbar = sendWrapper?.parentNode;
    if (!toolbar) return;
    const meter = this._build();
    meter.style.marginLeft = '0';
    meter.style.marginRight = '4px';
    meter.style.order = '-998';
    toolbar.insertBefore(meter, toolbar.firstChild);
  },

  _build() {
    const wrap = document.createElement('div');
    wrap.id = CONFIG.ids.contextMeter;
    wrap.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #8e8e93;
    user-select: none;
    margin-left: 8px;
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid #e9ecf0;
    vertical-align: middle;
    `;
    wrap.innerHTML = `
    <div style="width: 54px; height: 5px; border-radius: 3px; background: #e9ecf0; overflow: hidden; flex-shrink: 0;">
    <div class="deepblue-context-fill" style="height: 100%; width: 0%; background: #3964fe; transition: width 200ms ease, background-color 200ms ease;"></div>
    </div>
    <span class="deepblue-context-label">0%</span>
    `;
    return wrap;
  },

  scan(messages) {
    try {
      this.ensureInjected();
      const el = document.getElementById(CONFIG.ids.contextMeter);
      if (!el) return;

      const exactTokens = Bridge.latestTokenUsage;
      const isExact = typeof exactTokens === 'number';
      // Only fall back to the (comparatively expensive) DOM-based estimate
      // when the bridge hasn't reported a real usage figure yet - and even
      // then, reuse the shared `messages` list instead of re-querying it.
      const tokens = isExact ? exactTokens : ContextEstimator.estimateConversation(messages);

      const limit = CONFIG.contextWindow.limit;
      const pct = limit > 0 ? Math.min(100, (tokens / limit) * 100) : 0;

      const fill = el.querySelector('.deepblue-context-fill');
      const label = el.querySelector('.deepblue-context-label');
      if (fill) {
        fill.style.width = `${pct.toFixed(1)}%`;
        fill.style.background = pct > 90 ? '#ff6b6b' : pct > 70 ? '#feca57' : '#3964fe';
      }
      if (label) {
        label.textContent = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
      }

      el.title = isExact
        ? `${tokens.toLocaleString()} / ${limit.toLocaleString()} tokens (exact, reported by DeepSeek)`
        : `~${tokens.toLocaleString()} / ${limit.toLocaleString()} tokens estimated\n` +
          `Estimate only - waiting on the first response to get an exact count from DeepSeek.`;
    } catch (err) {
      console.debug(`${BRAND_NAME}: context meter error`, err);
    }
  },
};
