// export/download-menu.js - small popover shown when a "download" button is
// clicked, letting the person choose PDF / JSON / plain text before anything
// is actually generated. Used by both the whole-conversation download
// button (features/toolbar.js) and the per-message download button
// (features/message-pdf-export.js), so the choice always looks and behaves
// the same no matter which button opened it.
//
// This module only renders the choice UI and hands the picked format back
// to whoever opened it - it knows nothing about PDFs, JSON, or text itself.
// The actual export work stays in pdf/pdf-export.js and
// export/format-export.js.
//
// Depends on: config.js (CONFIG, BRAND_NAME).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const DownloadMenu = {
  _menuEl: null,
  _outsideHandler: null,
  _keyHandler: null,

  _FORMATS() {
    return [
      {
        format: 'pdf',
        label: Lang.t('download.pdf.label'),
        desc: Lang.t('download.pdf.desc'),
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="2.5" width="14" height="19" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M9 12.5h6M9 16h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 8.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
      },
      {
        format: 'json',
        label: Lang.t('download.json.label'),
        desc: Lang.t('download.json.desc'),
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3.5c-2 0-2.5 1-2.5 2.5v3c0 1-.5 2-2 2 1.5 0 2 1 2 2v3c0 1.5.5 2.5 2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3.5c2 0 2.5 1 2.5 2.5v3c0 1 .5 2 2 2-1.5 0-2 1-2 2v3c0 1.5-.5 2.5-2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      },
      {
        format: 'txt',
        label: Lang.t('download.txt.label'),
        desc: Lang.t('download.txt.desc'),
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3h9l3 3v15H6V3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 11h6M9 14.5h6M9 18h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
      },
    ];
  },

  isOpen() {
    return !!this._menuEl;
  },

  // anchorEl: the button that was clicked - the menu is positioned right
  // below it (or above, if there isn't room underneath).
  // onChoose(format): called with 'pdf' | 'json' | 'txt' once the person
  // picks an option. Never called if the menu is dismissed instead.
  open(anchorEl, onChoose) {
    this.close();
    if (!anchorEl) return;
    this._injectStyles();

    const menu = document.createElement('div');
    menu.id = CONFIG.ids.downloadMenu;
    menu.className = 'deepblue-download-menu';
    menu.setAttribute('role', 'menu');

    const label = document.createElement('div');
    label.className = 'deepblue-download-menu__label';
    label.textContent = Lang.t('download.as');
    menu.appendChild(label);

    this._FORMATS().forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'deepblue-download-menu__item';
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `
      <span class="deepblue-download-menu__icon">${opt.icon}</span>
      <span class="deepblue-download-menu__text">
        <span class="deepblue-download-menu__title">${opt.label}</span>
        <span class="deepblue-download-menu__desc">${opt.desc}</span>
      </span>
      `;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        onChoose(opt.format);
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    this._menuEl = menu;
    this._position(menu, anchorEl);

    // Deferred so the click that opened the menu doesn't immediately count
    // as an "outside" click and close it again in the same tick.
    setTimeout(() => {
      this._outsideHandler = (e) => {
        if (menu.contains(e.target) || anchorEl.contains(e.target)) return;
        this.close();
      };
      document.addEventListener('click', this._outsideHandler);
    }, 0);

    this._keyHandler = (e) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this._keyHandler);
  },

  close() {
    if (this._menuEl) {
      this._menuEl.remove();
      this._menuEl = null;
    }
    if (this._outsideHandler) {
      document.removeEventListener('click', this._outsideHandler);
      this._outsideHandler = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  },

  // Prefers opening below-and-right-aligned to the anchor (natural for a
  // toolbar button), but flips above/left as needed to stay on-screen -
  // the menu's own measured size is used rather than a guessed constant,
  // so this stays correct if the menu's content (and therefore height)
  // ever changes.
  _position(menu, anchorEl) {
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 8;
    const margin = 8;

    let top = anchorRect.bottom + gap;
    if (top + menuRect.height > window.innerHeight - margin) {
      top = anchorRect.top - menuRect.height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));

    let left = anchorRect.right - menuRect.width;
    if (left < margin) left = anchorRect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  },

  _injectStyles() {
    if (document.getElementById('deepblue-download-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-download-menu-styles';
    style.textContent = `
    .deepblue-download-menu {
      position: fixed;
      z-index: 1000000;
      width: 236px;
      background: var(--db-surface);
      border: 1px solid var(--db-border);
      border-radius: 14px;
      box-shadow: var(--db-shadow-lg);
      padding: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .deepblue-download-menu__label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--db-text-secondary);
      padding: 6px 10px 4px;
    }
    .deepblue-download-menu__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      border: none;
      background: none;
      cursor: pointer;
      padding: 8px 10px;
      border-radius: 9px;
      text-align: left;
      color: var(--db-text);
      transition: background 0.12s ease;
    }
    .deepblue-download-menu__item:hover,
    .deepblue-download-menu__item:focus-visible {
      background: var(--db-surface-hover);
      outline: none;
    }
    .deepblue-download-menu__icon {
      flex-shrink: 0;
      display: flex;
      color: var(--db-accent);
    }
    .deepblue-download-menu__text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .deepblue-download-menu__title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
    }
    .deepblue-download-menu__desc {
      font-size: 11.5px;
      color: var(--db-text-secondary);
      line-height: 1.3;
    }
    `;
    document.head.appendChild(style);
  },
};
