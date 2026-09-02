// features/prompt-library.js - a small library of reusable prompt snippets,
// launched from a button injected into the composer toolbar (right beside
// the copy-conversation / download buttons built in toolbar.js).
//
// Opening it shows a searchable list of saved prompts. Clicking one inserts
// its text into the composer at the cursor and focuses it - the whole
// point is "find it, use it" in as few clicks as possible. Adding, editing,
// and deleting prompts all happen inline in the same panel, no separate
// settings page. A handful of genuinely useful defaults are seeded the
// very first time the panel is opened, so it's never empty on day one.
//
// Prompts are stored once (Store.getPrompts/setPrompts, backed by
// localStorage) and shared across every conversation - a prompt library is
// useful precisely because it isn't tied to any one chat.
//
// Depends on: config.js, dom.js, store.js (Store), utils.js (uid, escapeHtml,
// setNativeInputValue).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const PromptLibrary = {
  _panelOpen: false,
  _editingId: null, // id of the prompt currently open in its inline edit form, or null
  _addingNew: false,
  _searchTerm: '',

  // -- persistence -----------------------------------------------------------

  _all() {
    let list = Store.getPrompts();
    if (list === null) {
      list = CONFIG.prompts.defaults.map((p) => ({ ...p, id: uid(), createdAt: Date.now() }));
      Store.setPrompts(list);
    }
    return list;
  },

  _save(list) {
    Store.setPrompts(list);
  },

  _add(title, content) {
    const list = this._all();
    const prompt = {
      id: uid(),
      title: title.trim() || 'Untitled prompt',
      content: content.trim(),
      createdAt: Date.now(),
    };
    list.push(prompt);
    this._save(list);
    return prompt;
  },

  _update(id, title, content) {
    const list = this._all();
    const prompt = list.find((p) => p.id === id);
    if (!prompt) return;
    prompt.title = title.trim() || 'Untitled prompt';
    prompt.content = content.trim();
    this._save(list);
  },

  _remove(id) {
    const list = this._all().filter((p) => p.id !== id);
    this._save(list);
  },

  // -- inserting into the composer -------------------------------------------

  _insert(content) {
    const textarea = DOM.findTextarea();
    if (!content) return;
    if (!textarea) {
      alert('Could not find the message box. Click into it and try again.');
      return;
    }

    const current = textarea.value;
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const next = current.slice(0, start) + content + current.slice(end);
    setNativeInputValue(textarea, next);

    const cursorPos = start + content.length;
    textarea.focus();
    requestAnimationFrame(() => {
      try {
        textarea.setSelectionRange(cursorPos, cursorPos);
      } catch (err) {
        // Some input types don't support selection ranges - harmless no-op.
      }
    });
  },

  // -- launcher button, injected next to the other toolbar buttons -----------

  ensureInjected() {
    if (document.getElementById(CONFIG.ids.promptLibraryBtn)) return;
    // Anchors off the download button toolbar.js already injects, the same
    // way toolbar.js's own copy-conversation button anchors off it - this
    // keeps the whole group of composer-toolbar buttons in one place to
    // maintain (toolbar.js), while this file only builds and positions its
    // own button relative to a stable, already-guaranteed-present sibling.
    const exportBtn = document.getElementById(CONFIG.ids.exportBtn);
    if (!exportBtn || !exportBtn.parentNode) return;

    this._injectStyles();
    const btn = this._buildLauncherButton();
    exportBtn.parentNode.insertBefore(btn, exportBtn);
    // Flex `order` (not DOM position) controls visual placement here, same
    // pattern as the export/copy-conversation buttons - this sits left of
    // both (996 < 997 < 998).
    btn.style.order = '996';
  },

  _buildLauncherButton() {
    const btn = document.createElement('div');
    btn.id = CONFIG.ids.promptLibraryBtn;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', `Prompt library (${BRAND_NAME})`);
    btn.className =
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m';
    btn.style.cssText =
      '--dsl-button-height: 34px; cursor: pointer; flex-shrink: 0; margin-right: 4px;';
    btn.title = `Prompt library (${BRAND_NAME})`;
    btn.innerHTML = `
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">${this._bookIcon()}</div>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePanel(btn);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._togglePanel(btn);
      }
    });
    return btn;
  },

  _bookIcon() {
    return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 4.5C4 3.7 4.7 3 5.5 3H12v18H5.5c-.8 0-1.5-.7-1.5-1.5v-15z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M20 4.5c0-.8-.7-1.5-1.5-1.5H12v18h6.5c.8 0 1.5-.7 1.5-1.5v-15z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M7 7.5h3M7 10.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    `;
  },

  // -- panel -------------------------------------------------------------

  _togglePanel(anchorBtn) {
    if (this._panelOpen) this._closePanel();
    else this._openPanel(anchorBtn);
  },

  _openPanel(anchorBtn) {
    this._panelOpen = true;
    this._editingId = null;
    this._addingNew = false;
    this._searchTerm = '';

    const panel = document.createElement('div');
    panel.id = CONFIG.ids.promptLibraryPanel;
    panel.className = 'deepblue-prompt-panel';

    const header = document.createElement('div');
    header.className = 'deepblue-prompt-panel__header';
    header.innerHTML = `<span class="deepblue-prompt-panel__title">Prompt Library</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'deepblue-prompt-panel__close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closePanel();
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'deepblue-prompt-panel__search-wrap';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search prompts\u2026';
    search.className = 'deepblue-prompt-panel__search';
    search.addEventListener('input', () => {
      this._searchTerm = search.value.trim().toLowerCase();
      this._renderList();
    });
    // Don't let DeepSeek's own global keydown handlers (e.g. anything
    // listening for Enter to send a message) react while typing here.
    search.addEventListener('keydown', (e) => e.stopPropagation());
    searchWrap.appendChild(search);
    panel.appendChild(searchWrap);
    this._searchEl = search;

    const list = document.createElement('div');
    list.className = 'deepblue-prompt-panel__list';
    panel.appendChild(list);
    this._listEl = list;

    const footer = document.createElement('div');
    footer.className = 'deepblue-prompt-panel__footer';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'deepblue-prompt-panel__add-btn';
    addBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
    <span>New prompt</span>
    `;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._editingId = null;
      this._addingNew = true;
      this._renderList();
    });
    footer.appendChild(addBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);
    this._positionPanel(panel, anchorBtn);
    this._renderList();

    setTimeout(() => {
      this._outsideHandler = (e) => {
        if (panel.contains(e.target) || anchorBtn.contains(e.target)) return;
        this._closePanel();
      };
      document.addEventListener('click', this._outsideHandler);
    }, 0);

    this._escHandler = (e) => {
      if (e.key === 'Escape') this._closePanel();
    };
    document.addEventListener('keydown', this._escHandler);
  },

  // Anchors above the composer toolbar (where the launcher lives, near the
  // bottom of the page) rather than below it, since there's rarely room
  // underneath a bottom-docked composer.
  _positionPanel(panel, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const margin = 12;
    panel.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - 340 - margin))}px`;
    panel.style.bottom = `${Math.max(margin, window.innerHeight - rect.top + 10)}px`;
  },

  _closePanel() {
    this._panelOpen = false;
    this._editingId = null;
    this._addingNew = false;
    document.getElementById(CONFIG.ids.promptLibraryPanel)?.remove();
    this._listEl = null;
    this._searchEl = null;
    if (this._outsideHandler) {
      document.removeEventListener('click', this._outsideHandler);
      this._outsideHandler = null;
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  },

  _matchesSearch(prompt) {
    if (!this._searchTerm) return true;
    return (
      prompt.title.toLowerCase().includes(this._searchTerm) ||
      prompt.content.toLowerCase().includes(this._searchTerm)
    );
  },

  _renderList() {
    const list = this._listEl;
    if (!list) return;
    list.innerHTML = '';

    if (this._addingNew) {
      list.appendChild(this._buildForm(null));
    }

    const prompts = this._all().filter((p) => this._matchesSearch(p));

    if (!prompts.length && !this._addingNew) {
      const empty = document.createElement('div');
      empty.className = 'deepblue-prompt-panel__empty';
      empty.textContent = this._searchTerm
        ? 'No prompts match your search.'
        : 'No saved prompts yet. Add your first one below.';
      list.appendChild(empty);
      return;
    }

    prompts
      .slice()
      .reverse()
      .forEach((prompt) => {
        if (this._editingId === prompt.id) {
          list.appendChild(this._buildForm(prompt));
        } else {
          list.appendChild(this._buildRow(prompt));
        }
      });
  },

  _buildRow(prompt) {
    const row = document.createElement('div');
    row.className = 'deepblue-prompt-panel__row';
    row.title = 'Click to insert into your message';

    const text = document.createElement('div');
    text.className = 'deepblue-prompt-panel__row-text';
    const snippet =
      prompt.content.length > CONFIG.prompts.snippetLength
        ? prompt.content.slice(0, CONFIG.prompts.snippetLength) + '\u2026'
        : prompt.content;
    text.innerHTML = `
    <span class="deepblue-prompt-panel__row-title">${escapeHtml(prompt.title)}</span>
    <span class="deepblue-prompt-panel__row-snippet">${escapeHtml(snippet)}</span>
    `;
    row.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'deepblue-prompt-panel__row-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'deepblue-prompt-panel__row-action';
    editBtn.title = 'Edit';
    editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 20l.9-4L17 3.9a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1L8 19l-4 1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._addingNew = false;
      this._editingId = prompt.id;
      this._renderList();
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'deepblue-prompt-panel__row-action deepblue-prompt-panel__row-action--danger';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '\u00d7';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._remove(prompt.id);
      this._renderList();
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);

    row.addEventListener('click', () => {
      this._insert(prompt.content);
      this._closePanel();
    });

    return row;
  },

  // Shared inline add/edit form. `prompt` is null when adding a new one.
  _buildForm(prompt) {
    const form = document.createElement('div');
    form.className = 'deepblue-prompt-panel__form';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Title (e.g. "Explain simply")';
    titleInput.maxLength = 60;
    titleInput.className = 'deepblue-prompt-panel__form-title';
    titleInput.value = prompt ? prompt.title : '';
    form.appendChild(titleInput);

    const contentInput = document.createElement('textarea');
    contentInput.placeholder = 'Prompt text\u2026';
    contentInput.rows = 4;
    contentInput.className = 'deepblue-prompt-panel__form-content';
    contentInput.value = prompt ? prompt.content : '';
    form.appendChild(contentInput);

    [titleInput, contentInput].forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));

    const actions = document.createElement('div');
    actions.className = 'deepblue-prompt-panel__form-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'deepblue-prompt-panel__form-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._editingId = null;
      this._addingNew = false;
      this._renderList();
    });
    actions.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'deepblue-prompt-panel__form-btn deepblue-prompt-panel__form-btn--primary';
    saveBtn.textContent = prompt ? 'Save' : 'Add';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!contentInput.value.trim()) {
        contentInput.focus();
        return;
      }
      if (prompt) this._update(prompt.id, titleInput.value, contentInput.value);
      else this._add(titleInput.value, contentInput.value);
      this._editingId = null;
      this._addingNew = false;
      this._renderList();
    });
    actions.appendChild(saveBtn);

    form.appendChild(actions);

    setTimeout(() => titleInput.focus(), 0);
    return form;
  },

  // -- styles --------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById('deepblue-prompt-library-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-prompt-library-styles';
    style.textContent = `
    .deepblue-prompt-panel {
      position: fixed;
      width: 340px;
      max-height: 460px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18);
      z-index: 1000000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .deepblue-prompt-panel__header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid #f0f1f4; flex-shrink: 0;
    }
    .deepblue-prompt-panel__title { font-size: 13px; font-weight: 700; color: #1d1d1f; }
    .deepblue-prompt-panel__close {
      border: none; background: none; cursor: pointer; color: #8e8e93;
      font-size: 16px; line-height: 1; padding: 2px;
    }
    .deepblue-prompt-panel__search-wrap { padding: 8px 12px; flex-shrink: 0; border-bottom: 1px solid #f5f6f8; }
    .deepblue-prompt-panel__search {
      width: 100%; box-sizing: border-box; font-size: 12.5px; font-family: inherit;
      border: 1.5px solid #e5e7eb; border-radius: 9px; padding: 6px 10px; outline: none;
    }
    .deepblue-prompt-panel__search:focus { border-color: #3964fe; }
    .deepblue-prompt-panel__list { overflow-y: auto; flex: 1 1 auto; min-height: 60px; }
    .deepblue-prompt-panel__empty {
      padding: 24px 16px; text-align: center; color: #8e8e93; font-size: 12.5px; line-height: 1.5;
    }
    .deepblue-prompt-panel__row {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; border-bottom: 1px solid #f5f6f8; cursor: pointer;
      transition: background 0.12s ease;
    }
    .deepblue-prompt-panel__row:hover { background: #f7f8fa; }
    .deepblue-prompt-panel__row-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .deepblue-prompt-panel__row-title { font-size: 12.5px; font-weight: 700; color: #1d1d1f; }
    .deepblue-prompt-panel__row-snippet {
      font-size: 11.5px; color: #8e8e93; line-height: 1.35;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .deepblue-prompt-panel__row-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .deepblue-prompt-panel__row-action {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 6px; border: none; background: none;
      color: #8e8e93; cursor: pointer; padding: 0; font-size: 14px; line-height: 1;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .deepblue-prompt-panel__row-action:hover { background: #eef1ff; color: #3964fe; }
    .deepblue-prompt-panel__row-action--danger:hover { background: #fef2f2; color: #ef4444; }
    .deepblue-prompt-panel__footer { padding: 8px 12px; border-top: 1px solid #f0f1f4; flex-shrink: 0; }
    .deepblue-prompt-panel__add-btn {
      display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%;
      border: 1.5px dashed #c9ccd3; background: none; border-radius: 9px; padding: 7px 0;
      color: #6c6c72; font-size: 12.5px; font-weight: 600; cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }
    .deepblue-prompt-panel__add-btn:hover { background: #eef1ff; color: #3964fe; border-color: #3964fe; }
    .deepblue-prompt-panel__form { padding: 10px 12px; border-bottom: 1px solid #f5f6f8; display: flex; flex-direction: column; gap: 6px; }
    .deepblue-prompt-panel__form-title, .deepblue-prompt-panel__form-content {
      width: 100%; box-sizing: border-box; font-size: 12.5px; font-family: inherit;
      border: 1.5px solid #e5e7eb; border-radius: 8px; padding: 6px 9px; outline: none; resize: vertical;
    }
    .deepblue-prompt-panel__form-title:focus, .deepblue-prompt-panel__form-content:focus { border-color: #3964fe; }
    .deepblue-prompt-panel__form-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .deepblue-prompt-panel__form-btn {
      border: 1.5px solid #e5e7eb; background: #ffffff; border-radius: 8px;
      padding: 5px 12px; font-size: 12px; font-weight: 600; color: #6c6c72; cursor: pointer;
    }
    .deepblue-prompt-panel__form-btn--primary { background: #3964fe; border-color: #3964fe; color: #ffffff; }
    `;
    document.head.appendChild(style);
  },
};
