// features/vamimi-link.js - a permanent, quiet link to VamimiAI at the
// bottom of DeepSeek's sidebar, just above the profile row.
//
// Why here: the Diagram button (diagram-handoff.js) comes and goes with
// the message, and the announcement (whats-new.js) shows once, so this is
// the one place anyone can always go to VamimiAI from. The bottom of a
// sidebar is where people expect "other apps and extras"; it never moves,
// never animates and never covers anything. It is a real <a> link, so
// middle-click, "open in new tab" and copy-link all work, and it opens in
// a new tab labelled utm_campaign=sidebar.
//
// Re-inserted on every scan if DeepSeek re-renders the sidebar. If the
// profile row is not found (DeepSeek changed its markup) nothing is shown,
// rather than guessing a spot.
//
// Styles: .deepblue-vamimi-link in src/theme.css.
// Depends on: config.js (CONFIG.selectors.sidebarProfileRow, CONFIG.ids),
// i18n.js (Lang), utils.js (escapeHtml), features/diagram-handoff.js
// (DiagramHandoff.appUrl, DiagramHandoff._icon).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array.

'use strict';

const VamimiLink = {
  ensureInjected() {
    try {
      if (document.getElementById(CONFIG.ids.vamimiLink)) return;
      const profile = document.querySelector(CONFIG.selectors.sidebarProfileRow);
      if (!profile || !profile.parentElement) return;
      profile.parentElement.insertBefore(this._build(), profile);
    } catch (err) {
      console.debug(`${BRAND_NAME}: VamimiAI link error`, err);
    }
  },

  _build() {
    const a = document.createElement('a');
    a.id = CONFIG.ids.vamimiLink;
    a.className = 'deepblue-vamimi-link';
    a.href = DiagramHandoff.appUrl('sidebar');
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.dbTip = Lang.t('vamimiLink.tip');
    a.innerHTML = `
      <span class="deepblue-vamimi-link__tile" aria-hidden="true">${DiagramHandoff._icon()}</span>
      <span class="deepblue-vamimi-link__text">
        <b>${escapeHtml(Lang.t('vamimiLink.title'))}</b>
        <small>${escapeHtml(Lang.t('vamimiLink.sub'))}</small>
      </span>
      <svg class="deepblue-vamimi-link__go" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 16L16 8M9.5 8H16v6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    a.setAttribute('aria-label', `${Lang.t('vamimiLink.title')}: ${Lang.t('vamimiLink.sub')}`);
    return a;
  },
};
