// features/sidebar-search.js - filters the sidebar conversation list by title.
//
// Depends on: config.js, dom.js.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const SidebarSearch = {
  ensureInjected() {
    if (document.getElementById(CONFIG.ids.sidebarSearchBar)) return;

    const newChatRow = DOM.findSidebarNewChatRow();
    if (!newChatRow || !newChatRow.parentElement) return;

    newChatRow.insertAdjacentElement('afterend', this._build());
  },

  _build() {
    const container = document.createElement('div');
    container.id = CONFIG.ids.sidebarSearchBar;
    container.style.cssText = `
 display: flex;
 align-items: center;
 gap: 8px;
 margin: 8px 12px;
 padding: 4px 10px;
 background: var(--db-surface-sunken);
 border-radius: 20px;
 border: 1.5px solid transparent;
 transition: all 0.25s ease;
 font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
 flex-shrink: 0;
 `;

    container.addEventListener('focusin', () => {
      container.style.background = 'var(--db-surface)';
      container.style.borderColor = 'var(--db-accent)';
      container.style.boxShadow = 'var(--db-ring)';
    });

    container.addEventListener('focusout', () => {
      container.style.background = 'var(--db-surface-sunken)';
      container.style.borderColor = 'transparent';
      container.style.boxShadow = 'none';
    });

    container.innerHTML = `
 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0; opacity: 0.5;">
 <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
 <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
 </svg>
 <input id="${CONFIG.ids.sidebarSearchInput}" type="text" placeholder="Search conversations..." style="
 border: none;
 background: transparent;
 outline: none;
 font-size: 13px;
 padding: 6px 0;
 width: 100%;
 color: var(--db-text);
 font-family: inherit;
 ">
 <button id="${CONFIG.ids.sidebarSearchClear}" style="
 background: none;
 border: none;
 cursor: pointer;
 padding: 4px 4px;
 color: var(--db-text-secondary);
 border-radius: 6px;
 display: flex;
 align-items: center;
 justify-content: center;
 opacity: 0;
 pointer-events: none;
 flex-shrink: 0;
 " title="Clear search">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
 </svg>
 </button>
 `;

    const input = container.querySelector(`#${CONFIG.ids.sidebarSearchInput}`);
    const clearBtn = container.querySelector(`#${CONFIG.ids.sidebarSearchClear}`);

    if (clearBtn) {
      clearBtn.addEventListener('mouseenter', () => {
        clearBtn.style.background = 'var(--db-danger-soft)';
        clearBtn.style.color = 'var(--db-danger)';
      });
      clearBtn.addEventListener('mouseleave', () => {
        clearBtn.style.background = 'none';
        clearBtn.style.color = 'var(--db-text-secondary)';
      });
      clearBtn.addEventListener('click', () => this.clear());
    }

    if (input) {
      input.addEventListener('input', () => this._applyFilter(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.clear();
      });
    }

    return container;
  },

  _applyFilter(query, links) {
    const term = (query || '').trim().toLowerCase();
    const clearBtn = document.getElementById(CONFIG.ids.sidebarSearchClear);
    if (clearBtn) {
      clearBtn.style.opacity = term ? '0.6' : '0';
      clearBtn.style.pointerEvents = term ? 'auto' : 'none';
    }

    (links || DOM.getSidebarConversationLinks()).forEach((link) => {
      const titleEl = link.querySelector(CONFIG.selectors.sidebarConversationTitle);
      const title = (titleEl?.textContent || link.textContent || '').toLowerCase();
      const matches = !term || title.includes(term);
      link.style.display = matches ? '' : 'none';
    });

    // Hide a date-group header (e.g. "Today") if every link under it is hidden
    document.querySelectorAll(CONFIG.selectors.sidebarDateGroup).forEach((group) => {
      const groupLinks = Array.from(
        group.querySelectorAll(CONFIG.selectors.sidebarConversationLink)
      );
      if (!groupLinks.length) return;
      const anyVisible = groupLinks.some((l) => l.style.display !== 'none');
      const label = group.querySelector(CONFIG.selectors.sidebarDateLabel);
      if (label) label.style.display = anyVisible ? '' : 'none';
    });
  },

  clear() {
    const input = document.getElementById(CONFIG.ids.sidebarSearchInput);
    if (input) {
      input.value = '';
      this._applyFilter('');
      input.focus();
    }
  },

  _reapplyIfActive(links) {
    const input = document.getElementById(CONFIG.ids.sidebarSearchInput);
    if (input && input.value.trim()) {
      this._applyFilter(input.value, links);
    }
  },
};
