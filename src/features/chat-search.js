// features/chat-search.js - in-chat search bar with next/prev navigation.
//
// Works against DeepSeek's virtualized message list.
// Depends on: config.js, dom.js, utils.js (debounce).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const ChatSearch = {
  _searchResults: [],
  _currentIndex: -1,
  _isSearching: false,
  _observer: null,

  // Both the live 'input' listener and the mutation observer below used
  // to call _performSearch() directly and synchronously - on every single
  // keystroke, and on every DOM mutation batch observed on the message
  // list (which, while a response is actively streaming in, can fire many
  // times per second). Each call re-walks and re-highlights the entire
  // visible conversation, so debouncing here is what keeps typing quick
  // search terms - or having a search active while a reply streams in -
  // from turning into a lot of redundant full-conversation re-scans.
  // Explicit, discrete actions (clearing the box) still call
  // _performSearch() directly for instant feedback.
  _debouncedSearch: debounce((query) => ChatSearch._performSearch(query), 150),

  ensureInjected() {
    if (document.getElementById(CONFIG.ids.searchBar)) return;

    const header = DOM.findHeaderContainer();
    if (!header) {
      const titleContainer = DOM.findTitleContainer();
      if (!titleContainer) return;

      let parent = titleContainer.parentElement;
      let attempts = 0;
      while (parent && attempts < 5) {
        const style = window.getComputedStyle(parent);
        if (style.display === 'flex' || style.display === 'inline-flex') {
          break;
        }
        parent = parent.parentElement;
        attempts++;
      }
      if (parent) {
        parent.appendChild(this._build());
      }
      return;
    }

    header.appendChild(this._build());

    // Set up a MutationObserver to watch for new messages appearing
    this._setupObserver();
  },

  _setupObserver() {
    if (this._observer) return;

    this._observer = new MutationObserver(() => {
      // If we have an active search, re-run it when new messages appear
      const input = document.getElementById(CONFIG.ids.searchInput);
      if (input && input.value.trim()) {
        this._debouncedSearch(input.value);
      }
    });

    // Watch the virtual list container for changes
    const container =
      document.querySelector(CONFIG.selectors.virtualListItems) ||
      document.querySelector('.ds-virtual-list-visible-items');
    if (container) {
      this._observer.observe(container, { childList: true, subtree: true });
    }
  },

  _build() {
    const container = document.createElement('div');
    container.id = CONFIG.ids.searchBar;
    container.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 12px;
    padding: 4px 10px;
    background: var(--db-surface-sunken);
    border-radius: 20px;
    border: 1.5px solid transparent;
    transition: all 0.25s ease;
    font-family: var(--db-font);
    flex-shrink: 0;
    min-width: 200px;
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0; opacity: 0.5; transition: opacity 0.2s;">
    <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
    <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <input id="${CONFIG.ids.searchInput}" type="text" placeholder="Search in conversation..." style="
    border: none;
    background: transparent;
    outline: none;
    font-size: 13px;
    padding: 6px 0;
    width: 160px;
    min-width: 120px;
    color: var(--db-text);
    font-family: inherit;
    transition: width 0.3s ease;
    ">
    <span id="${CONFIG.ids.searchCount}" style="
    font-size: 12px;
    color: var(--db-text-secondary);
    min-width: 42px;
    text-align: center;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
    ">0</span>
    <div style="display: flex; align-items: center; gap: 2px; border-left: 1px solid var(--db-border-strong); padding-left: 6px;">
    <button id="${CONFIG.ids.searchPrev}" style="
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    color: var(--db-text-secondary);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
    opacity: 0.5;
    " title="Previous match (↑)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 15L12 9L6 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    </button>
    <button id="${CONFIG.ids.searchNext}" style="
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    color: var(--db-text-secondary);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
    opacity: 0.5;
    " title="Next match (↓)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    </button>
    </div>
    <button id="${CONFIG.ids.searchClear}" style="
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 4px;
    color: var(--db-text-secondary);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
    opacity: 0;
    pointer-events: none;
    " title="Clear search">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    </button>
    `;

    const prevBtn = container.querySelector(`#${CONFIG.ids.searchPrev}`);
    const nextBtn = container.querySelector(`#${CONFIG.ids.searchNext}`);
    const clearBtn = container.querySelector(`#${CONFIG.ids.searchClear}`);

    [prevBtn, nextBtn].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'var(--db-surface-hover)';
        btn.style.color = 'var(--db-text)';
        btn.style.opacity = '1';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'none';
        btn.style.color = 'var(--db-text-secondary)';
        btn.style.opacity = this._searchResults.length > 0 ? '0.7' : '0.5';
      });
    });

    if (clearBtn) {
      clearBtn.addEventListener('mouseenter', () => {
        clearBtn.style.background = 'var(--db-danger-soft)';
        clearBtn.style.color = 'var(--db-danger)';
      });
      clearBtn.addEventListener('mouseleave', () => {
        clearBtn.style.background = 'none';
        clearBtn.style.color = 'var(--db-text-secondary)';
      });
    }

    const input = container.querySelector(`#${CONFIG.ids.searchInput}`);

    if (input) {
      input.addEventListener('input', () => {
        this._debouncedSearch(input.value);
      });

      input.addEventListener('focus', () => {
        container.style.background = 'var(--db-surface)';
        container.style.borderColor = 'var(--db-accent)';
        container.style.boxShadow = 'var(--db-ring)';
      });

      input.addEventListener('blur', () => {
        if (!input.value) {
          container.style.background = 'var(--db-surface-sunken)';
          container.style.borderColor = 'transparent';
          container.style.boxShadow = 'none';
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this._navigate(-1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this._navigate(1);
        } else if (e.key === 'Escape') {
          this.clear();
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => this._navigate(-1));
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => this._navigate(1));
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }

    return container;
  },

  _performSearch(query) {
    // Guard against re-entrancy: the observer below can fire while we're
    // still writing highlights for a previous call.
    if (this._isSearching) return;
    this._isSearching = true;

    // Highlighting mutates the chat DOM (the same subtree _setupObserver
    // watches), so pause the observer while we write, or every highlight
    // we insert triggers another _performSearch and the tab hard-locks.
    if (this._observer) this._observer.disconnect();

    try {
      this._performSearchInner(query);
    } finally {
      this._isSearching = false;
      if (this._observer) {
        const container =
          document.querySelector(CONFIG.selectors.virtualListItems) ||
          document.querySelector('.ds-virtual-list-visible-items');
        if (container) {
          this._observer.observe(container, { childList: true, subtree: true });
        }
      }
    }
  },

  _performSearchInner(query) {
    this._clearHighlights();
    this._searchResults = [];
    this._currentIndex = -1;

    const input = document.getElementById(CONFIG.ids.searchInput);
    const clearBtn = document.getElementById(CONFIG.ids.searchClear);

    if (!query || !query.trim()) {
      this._updateUI(0);
      if (clearBtn) {
        clearBtn.style.opacity = '0';
        clearBtn.style.pointerEvents = 'none';
      }
      return;
    }

    if (clearBtn) {
      clearBtn.style.opacity = '0.6';
      clearBtn.style.pointerEvents = 'auto';
    }

    // Get ALL messages, not just visible ones
    const allMessages = DOM.getAllMessageElements();
    const searchTerm = query.trim().toLowerCase();
    let results = [];

    allMessages.forEach((message) => {
      // Get the text content of the message
      let textContent = '';
      const userMarker = message.querySelector(CONFIG.selectors.userMessageMarker);
      const markdown = message.querySelector(CONFIG.selectors.markdown);

      if (userMarker) {
        textContent = userMarker.textContent || '';
      } else if (markdown) {
        textContent = markdown.textContent || '';
      } else {
        textContent = message.textContent || '';
      }

      if (!textContent.toLowerCase().includes(searchTerm)) return;

      // Find the container where we can insert highlights
      const contentEl = markdown || userMarker || message;

      // Collect every matching text node FIRST, then mutate. A
      // TreeWalker's nextNode() computes the next node from the current
      // node's own parent/sibling references - if we replace the current
      // node (as highlighting does, via replaceChild) before asking for
      // the next one, that node has just been detached and no longer has
      // a parent to climb from, silently truncating the walk. Two
      // separate passes - gather, then mutate - sidesteps that entirely.
      const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (node.textContent.toLowerCase().includes(searchTerm)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        },
      });

      const matchingTextNodes = [];
      let walked;
      while ((walked = walker.nextNode())) matchingTextNodes.push(walked);

      let occurrenceIndex = 0;
      matchingTextNodes.forEach((textNode) => {
        const text = textNode.textContent;
        const lowerText = text.toLowerCase();
        let startIndex = 0;

        while ((startIndex = lowerText.indexOf(searchTerm, startIndex)) !== -1) {
          const before = text.substring(0, startIndex);
          const match = text.substring(startIndex, startIndex + searchTerm.length);
          const after = text.substring(startIndex + searchTerm.length);

          const fragment = document.createDocumentFragment();
          if (before) {
            fragment.appendChild(document.createTextNode(before));
          }

          const highlight = document.createElement('span');
          highlight.className = 'deepblue-search-highlight';
          highlight.textContent = match;
          highlight.style.background = '#fde68a';
          highlight.style.color = 'var(--db-text)';
          highlight.style.padding = '0 2px';
          highlight.style.borderRadius = '3px';
          highlight.style.fontWeight = '500';
          highlight.dataset.messageIndex = allMessages.indexOf(message);
          highlight.dataset.occurrenceIndex = occurrenceIndex;
          fragment.appendChild(highlight);

          if (after) {
            fragment.appendChild(document.createTextNode(after));
          }

          textNode.parentNode.replaceChild(fragment, textNode);

          results.push({
            element: highlight,
            message: message,
            messageIndex: allMessages.indexOf(message),
            occurrenceIndex: occurrenceIndex,
          });

          occurrenceIndex++;
          startIndex += searchTerm.length;
        }
      });
    });

    this._searchResults = results;

    if (results.length > 0) {
      this._currentIndex = 0;
      this._highlightResult(0);
    }

    this._updateUI(results.length);
    this._updateNavButtons(results.length > 0);
  },

  _clearHighlights() {
    document.querySelectorAll('.deepblue-search-highlight').forEach((el) => {
      const text = el.textContent;
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(text), el);
      parent.normalize();
    });
  },

  _updateUI(resultCount) {
    const countEl = document.getElementById(CONFIG.ids.searchCount);
    if (countEl) {
      if (resultCount === 0) {
        const input = document.getElementById(CONFIG.ids.searchInput);
        if (input && input.value.trim()) {
          countEl.textContent = '0';
          countEl.style.color = 'var(--db-danger)';
        } else {
          countEl.textContent = '0';
          countEl.style.color = 'var(--db-text-secondary)';
        }
      } else {
        countEl.textContent = `${this._currentIndex + 1}/${resultCount}`;
        countEl.style.color = 'var(--db-text-secondary)';
      }
    }
  },

  _updateNavButtons(hasResults) {
    const prevBtn = document.getElementById(CONFIG.ids.searchPrev);
    const nextBtn = document.getElementById(CONFIG.ids.searchNext);

    [prevBtn, nextBtn].forEach((btn) => {
      if (btn) {
        btn.style.opacity = hasResults ? '0.7' : '0.3';
        btn.style.cursor = hasResults ? 'pointer' : 'default';
      }
    });
  },

  _highlightResult(index) {
    document.querySelectorAll('.deepblue-search-highlight.active').forEach((el) => {
      el.style.background = '#fde68a';
      el.style.boxShadow = 'none';
      el.style.transform = 'scale(1)';
      el.classList.remove('active');
    });

    const results = this._searchResults;
    if (index < 0 || index >= results.length) return;

    const result = results[index];
    if (result && result.element) {
      result.element.style.background = '#fbbf24';
      result.element.style.boxShadow = '0 0 0 3px #f59e0b';
      result.element.style.transform = 'scale(1.05)';
      result.element.classList.add('active');

      // Scroll to the message
      const messageEl =
        result.element.closest(CONFIG.selectors.messages[0]) ||
        result.element.closest(CONFIG.selectors.messages[1]);
      if (messageEl) {
        const rect = messageEl.getBoundingClientRect();
        const isVisible =
          rect.top >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);

        if (!isVisible) {
          messageEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
          result.element.style.animation = 'deepblue-pulse 0.6s ease 2';
        }
      }
    }

    this._currentIndex = index;
    this._updateUI(results.length);
  },

  _navigate(direction) {
    if (this._searchResults.length === 0) return;

    let newIndex = this._currentIndex + direction;
    if (newIndex < 0) newIndex = this._searchResults.length - 1;
    if (newIndex >= this._searchResults.length) newIndex = 0;

    this._highlightResult(newIndex);
  },

  clear() {
    const input = document.getElementById(CONFIG.ids.searchInput);
    if (input) {
      input.value = '';
      this._performSearch('');
      input.focus();
    }
  },

  _injectStyles() {
    if (document.getElementById('deepblue-search-styles')) return;

    const style = document.createElement('style');
    style.id = 'deepblue-search-styles';
    style.textContent = `
    @keyframes deepblue-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    `;
    document.head.appendChild(style);
  },
};
