// features/folders.js - organizes sidebar conversations into colored, collapsible folders.
//
// Depends on: config.js, dom.js, store.js (Store), utils.js (uid,
// conversationIdFromHref, escapeHtml).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const Folders = {
  _expanded: {}, // folderId -> bool, in-memory only (resets on reload, harmless)
  _menuOpenFor: null,
  _draggingConvId: null, // same-page drag state; dataTransfer alone is unreliable across some setups

  ensureInjected(sidebarLinks) {
    if (document.getElementById(CONFIG.ids.folderSection)) {
      this._syncRows(sidebarLinks);
      return;
    }

    const anchor =
      document.getElementById(CONFIG.ids.sidebarSearchBar) || DOM.findSidebarNewChatRow();
    if (!anchor || !anchor.parentElement) return;

    anchor.insertAdjacentElement('afterend', this._buildSection());
    this._injectStyles();
    this._wireGlobalListeners();
    this._syncRows(sidebarLinks);
  },

  // -- persistence helpers --------------------------------------------

  _getFolders() {
    return Store.getFolders();
  },

  _saveFolders(folders) {
    Store.setFolders(folders);
  },

  _getAssignments() {
    return Store.getAssignments();
  },

  _saveAssignments(map) {
    Store.setAssignments(map);
  },

  _createFolder(name, hex) {
    const folders = this._getFolders();
    const folder = {
      id: uid(),
      name: name || Lang.t('folders.new.name'),
      color: hex || CONFIG.folders.palette[0].hex,
    };
    folders.push(folder);
    this._saveFolders(folders);
    this._expanded[folder.id] = true;
    this.render();
    return folder;
  },

  _renameFolder(id, name) {
    const folders = this._getFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    folder.name = name || folder.name;
    this._saveFolders(folders);
    this.render();
  },

  _recolorFolder(id, hex) {
    const folders = this._getFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    folder.color = hex;
    this._saveFolders(folders);
    this.render();
  },

  _deleteFolder(id) {
    const folders = this._getFolders().filter((f) => f.id !== id);
    this._saveFolders(folders);

    const assignments = this._getAssignments();
    Object.keys(assignments).forEach((convId) => {
      if (assignments[convId] === id) delete assignments[convId];
    });
    this._saveAssignments(assignments);

    delete this._expanded[id];
    this.render();
  },

  _assign(convId, folderId) {
    if (!convId) return;
    const assignments = this._getAssignments();
    if (folderId) {
      assignments[convId] = folderId;
    } else {
      delete assignments[convId];
    }
    this._saveAssignments(assignments);
    this.render();
  },

  // -- top-level section (folder list + "new folder") ------------------

  _buildSection() {
    const section = document.createElement('div');
    section.id = CONFIG.ids.folderSection;
    section.style.cssText = `
 display: flex;
 flex-direction: column;
 margin: 6px 12px 10px;
 font-family: var(--db-font);
 `;

    const header = document.createElement('div');
    header.style.cssText = `
 display: flex;
 align-items: center;
 justify-content: space-between;
 padding: 2px 4px 6px;
 `;
    header.innerHTML = `
 <span style="display:flex; align-items:center; gap:6px; font-size: 11px; font-weight: 700; color: var(--db-text-secondary); text-transform: uppercase; letter-spacing: 0.6px;">
 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
 <path d="M3 7C3 5.89543 3.89543 5 5 5H9L11 7H19C20.1046 7 21 7.89543 21 9V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
 </svg>
 ${Lang.t('folders.title')}
 </span>
 `;

    const addBtn = document.createElement('button');
    addBtn.id = CONFIG.ids.folderAddBtn;
    addBtn.dataset.dbTip = Lang.t('folders.add.title');
    addBtn.style.cssText = `
 background: none;
 border: none;
 cursor: pointer;
 color: var(--db-text-secondary);
 display: flex;
 align-items: center;
 justify-content: center;
 width: 22px;
 height: 22px;
 border-radius: var(--db-radius-sm);
 transition: background var(--db-fast) var(--db-ease), color var(--db-fast) var(--db-ease), transform var(--db-fast) var(--db-ease-snap);
 `;
    addBtn.innerHTML = `
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
 </svg>
 `;
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.background = 'var(--db-accent-soft)';
      addBtn.style.color = 'var(--db-accent)';
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.background = 'none';
      addBtn.style.color = 'var(--db-text-secondary)';
    });
    addBtn.addEventListener('mousedown', () => (addBtn.style.transform = 'scale(0.92)'));
    addBtn.addEventListener('mouseup', () => (addBtn.style.transform = 'scale(1)'));
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const folder = this._createFolder(
        Lang.t('folders.new.name'),
        CONFIG.folders.palette[this._getFolders().length % CONFIG.folders.palette.length].hex
      );
      // Immediately open the rename editor for the new folder
      requestAnimationFrame(() => this._startRename(folder.id));
    });

    header.appendChild(addBtn);
    section.appendChild(header);

    const list = document.createElement('div');
    list.id = CONFIG.ids.folderList;
    list.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';
    section.appendChild(list);

    this._section = section;
    this._list = list;
    this.render();
    return section;
  },

  render() {
    const list = this._list || document.getElementById(CONFIG.ids.folderList);
    if (!list) return;

    const folders = this._getFolders();
    const assignments = this._getAssignments();

    list.innerHTML = '';

    if (!folders.length) {
      const empty = document.createElement('div');
      empty.textContent = Lang.t('folders.empty');
      empty.style.cssText = 'font-size: 12px; color: var(--db-text-secondary); padding: 6px 6px 6px;';
      list.appendChild(empty);
      return;
    }

    folders.forEach((folder) => {
      list.appendChild(this._buildFolderRow(folder, assignments));
    });
  },

  _countInFolder(folderId, assignments) {
    return Object.values(assignments).filter((f) => f === folderId).length;
  },

  _buildFolderRow(folder, assignments) {
    const wrap = document.createElement('div');
    wrap.className = 'deepblue-folder-row';
    wrap.dataset.folderId = folder.id;

    const isOpen = !!this._expanded[folder.id];
    const count = this._countInFolder(folder.id, assignments);
    const color = escapeHtml(folder.color);

    const head = document.createElement('div');
    head.className = 'deepblue-folder-head';
    head.style.cssText = `
 display: flex;
 align-items: center;
 gap: 7px;
 padding: 7px 7px;
 border-radius: var(--db-radius-sm);
 cursor: pointer;
 font-size: 13px;
 font-weight: 500;
 color: var(--db-text);
 user-select: none;
 transition: background var(--db-fast) var(--db-ease);
 `;
    head.addEventListener('mouseenter', () => {
      head.style.background = 'var(--db-surface-sunken)';
    });
    head.addEventListener('mouseleave', () => {
      head.style.background = 'none';
    });

    head.innerHTML = `
 <svg class="deepblue-folder-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
 style="flex-shrink:0; transition: transform var(--db-base) var(--db-ease); transform: rotate(${
   isOpen ? '90deg' : '0deg'
 }); color:var(--db-text-tertiary);">
 <path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 </svg>
 <span class="deepblue-folder-dot" style="width:9px; height:9px; border-radius:3.5px; background:${color}; box-shadow: 0 0 0 3px color-mix(in srgb, ${color} 18%, transparent); flex-shrink:0;"></span>
 <span class="deepblue-folder-name" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(
   folder.name
 )}</span>
 ${
   count
     ? `<span style="font-size:10.5px; font-weight:700; color:var(--db-text-secondary); background:var(--db-surface-sunken); border-radius:var(--db-radius-pill); min-width:16px; height:16px; padding:0 5px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${count}</span>`
     : ''
 }
 <button class="deepblue-folder-more" data-db-tip="${Lang.t('folders.options.title')}" style="
 background:none; border:none; cursor:pointer; color:var(--db-text-tertiary); display:flex;
 align-items:center; justify-content:center; width:20px; height:20px; border-radius:var(--db-radius-sm); flex-shrink:0;
 transition: background var(--db-fast) var(--db-ease), color var(--db-fast) var(--db-ease);
 ">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>
 </svg>
 </button>
 `;

    head.addEventListener('click', (e) => {
      if (e.target.closest('.deepblue-folder-more')) return;
      this._expanded[folder.id] = !this._expanded[folder.id];
      this.render();
    });

    const moreBtn = head.querySelector('.deepblue-folder-more');
    moreBtn.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      moreBtn.style.background = 'var(--db-surface-hover)';
      moreBtn.style.color = 'var(--db-text)';
    });
    moreBtn.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      moreBtn.style.background = 'none';
      moreBtn.style.color = 'var(--db-text-tertiary)';
    });
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleFolderMenu(folder, moreBtn);
    });

    // Drag-and-drop target
    head.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      head.style.background = 'var(--db-accent-soft)';
      head.style.outline = `1.5px dashed ${folder.color}`;
    });
    head.addEventListener('dragleave', () => {
      head.style.background = 'none';
      head.style.outline = 'none';
    });
    head.addEventListener('drop', (e) => {
      e.preventDefault();
      head.style.background = 'none';
      head.style.outline = 'none';
      const convId =
        this._draggingConvId ||
        e.dataTransfer.getData('text/deepblue-conv-id') ||
        e.dataTransfer.getData('text/plain');
      this._draggingConvId = null;
      if (convId) this._assign(convId, folder.id);
    });

    wrap.appendChild(head);

    if (isOpen) {
      const body = document.createElement('div');
      body.style.cssText =
        'display: flex; flex-direction: column; padding-left: 21px; border-left: 1.5px solid var(--db-border-soft); margin-left: 12px; animation: db-fade-in var(--db-base) var(--db-ease);';

      const convIds = Object.keys(assignments).filter((id) => assignments[id] === folder.id);
      if (!convIds.length) {
        const empty = document.createElement('div');
        empty.textContent = Lang.t('folders.empty.drag');
        empty.style.cssText = 'font-size: 11.5px; color: var(--db-text-tertiary); padding: 6px 6px 6px 8px;';
        body.appendChild(empty);
      } else {
        convIds.forEach((convId) => {
          body.appendChild(this._buildFolderItem(convId, folder));
        });
      }

      wrap.appendChild(body);
    }

    return wrap;
  },

  _buildFolderItem(convId, folder) {
    const link = this._findLiveLinkForConv(convId);
    const title =
      link?.querySelector(CONFIG.selectors.sidebarConversationTitle)?.textContent?.trim() ||
      Lang.t('folders.untitled');

    const row = document.createElement('div');
    row.style.cssText = `
 display: flex;
 align-items: center;
 gap: 6px;
 padding: 5px 6px;
 border-radius: 8px;
 cursor: pointer;
 font-size: 12.5px;
 color: var(--db-text-secondary);
 `;
    row.addEventListener('mouseenter', () => {
      row.style.background = 'var(--db-surface-sunken)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'none';
    });

    row.innerHTML = `
 <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(title)}</span>
 <button data-db-tip="${Lang.t('folders.item.remove.title')}" style="
 background:none; border:none; cursor:pointer; color:var(--db-text-secondary); opacity:0;
 display:flex; align-items:center; justify-content:center; padding:2px; border-radius:6px; flex-shrink:0;
 ">
 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
 </svg>
 </button>
 `;

    const removeBtn = row.querySelector('button');
    row.addEventListener('mouseenter', () => {
      removeBtn.style.opacity = '1';
    });
    row.addEventListener('mouseleave', () => {
      removeBtn.style.opacity = '0';
    });
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._assign(convId, null);
    });

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const liveLink = this._findLiveLinkForConv(convId);
      if (liveLink) liveLink.click();
    });

    return row;
  },

  _findLiveLinkForConv(convId) {
    return (
      DOM.getSidebarConversationLinks().find(
        (a) => conversationIdFromHref(a.getAttribute('href')) === convId
      ) || null
    );
  },

  // -- folder options menu (rename / recolor / delete) ------------------

  _toggleFolderMenu(folder, anchorEl) {
    const existing = document.getElementById(CONFIG.ids.folderMenu);
    if (existing) {
      existing.remove();
      if (this._menuOpenFor === folder.id) {
        this._menuOpenFor = null;
        return;
      }
    }
    this._menuOpenFor = folder.id;

    const menu = document.createElement('div');
    menu.id = CONFIG.ids.folderMenu;
    menu.style.cssText = `
 position: fixed;
 z-index: 999999;
 background: var(--db-surface);
 border: 1px solid var(--db-border);
 border-radius: var(--db-radius-md);
 box-shadow: var(--db-shadow-lg);
 padding: 8px;
 width: 196px;
 font-family: var(--db-font);
 `;

    const rect = anchorEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 196)}px`;

    const renameBtn = document.createElement('button');
    renameBtn.textContent = Lang.t('folders.menu.rename');
    renameBtn.style.cssText = this._menuItemStyle();
    renameBtn.addEventListener('mouseenter', () => (renameBtn.style.background = 'var(--db-surface-sunken)'));
    renameBtn.addEventListener('mouseleave', () => (renameBtn.style.background = 'none'));
    renameBtn.addEventListener('click', () => {
      menu.remove();
      this._menuOpenFor = null;
      this._startRename(folder.id);
    });
    menu.appendChild(renameBtn);

    const colorLabel = document.createElement('div');
    colorLabel.textContent = Lang.t('folders.menu.color');
    colorLabel.style.cssText =
      'font-size: 11px; color: var(--db-text-tertiary); padding: 8px 6px 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;';
    menu.appendChild(colorLabel);

    const swatches = document.createElement('div');
    swatches.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 6px 8px;';
    CONFIG.folders.palette.forEach((c) => {
      const isSelected = folder.color === c.hex;
      const sw = document.createElement('button');
      sw.dataset.dbTip = Lang.t(`folders.color.${c.name.toLowerCase()}`) || c.name;
      sw.style.cssText = `
   width: 20px; height: 20px; border-radius: 50%; background: ${c.hex}; cursor: pointer;
   border: 2px solid var(--db-surface);
   box-shadow: ${isSelected ? `0 0 0 2px ${c.hex}` : '0 0 0 1px var(--db-border)'};
   display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0;
   transition: transform var(--db-fast) var(--db-ease-snap), box-shadow var(--db-fast) var(--db-ease);
   `;
      if (isSelected) {
        sw.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 13L10 18L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
      }
      sw.addEventListener('mouseenter', () => (sw.style.transform = 'scale(1.14)'));
      sw.addEventListener('mouseleave', () => (sw.style.transform = 'scale(1)'));
      sw.addEventListener('click', () => {
        this._recolorFolder(folder.id, c.hex);
        menu.remove();
        this._menuOpenFor = null;
      });
      swatches.appendChild(sw);
    });
    menu.appendChild(swatches);

    const divider = document.createElement('div');
    divider.style.cssText = 'height: 1px; background: var(--db-border-soft); margin: 4px 0;';
    menu.appendChild(divider);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = Lang.t('folders.menu.delete');
    deleteBtn.style.cssText = this._menuItemStyle() + 'color:var(--db-danger);';
    deleteBtn.addEventListener('mouseenter', () => (deleteBtn.style.background = 'var(--db-danger-soft)'));
    deleteBtn.addEventListener('mouseleave', () => (deleteBtn.style.background = 'none'));
    deleteBtn.addEventListener('click', () => {
      menu.remove();
      this._menuOpenFor = null;
      this._deleteFolder(folder.id);
    });
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
  },

  _menuItemStyle() {
    return `
 display: block; width: 100%; text-align: left; background: none; border: none;
 cursor: pointer; font-size: 13px; color: var(--db-text); padding: 7px 8px; border-radius: var(--db-radius-sm);
 font-family: inherit; transition: background var(--db-fast) var(--db-ease);
 `;
  },

  _startRename(folderId) {
    const row = document.querySelector(
      `.deepblue-folder-row[data-folder-id="${folderId}"] .deepblue-folder-name`
    );
    const folder = this._getFolders().find((f) => f.id === folderId);
    if (!row || !folder) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = folder.name;
    input.style.cssText = `
 flex: 1; font-size: 13px; border: 1px solid var(--db-accent); border-radius: 4px;
 padding: 1px 4px; font-family: inherit; outline: none; width: 100%;
 `;

    row.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      this._renameFolder(folderId, input.value.trim() || folder.name);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = folder.name;
        input.blur();
      }
    });
  },

  // -- per-conversation "add to folder" affordance ----------------------

  _syncRows(links) {
    (links || DOM.getSidebarConversationLinks()).forEach((link) => this._decorateRow(link));
  },

  _decorateRow(link) {
    if (link.dataset.deepblueFolderized) return;
    link.dataset.deepblueFolderized = '1';

    const convId = conversationIdFromHref(link.getAttribute('href'));
    if (!convId) return;

    const currentPosition = window.getComputedStyle(link).position;
    if (currentPosition === 'static') {
      link.style.position = 'relative';
    }

    link.draggable = true;
    link.addEventListener('dragstart', (e) => {
      this._draggingConvId = convId;
      try {
        e.dataTransfer.setData('text/plain', convId);
        e.dataTransfer.setData('text/deepblue-conv-id', convId);
      } catch (err) {
        // Some browsers throw on custom MIME types in certain contexts;
        // _draggingConvId above is the reliable fallback for same-page drags.
      }
      e.dataTransfer.effectAllowed = 'move';
    });
    link.addEventListener('dragend', () => {
      this._draggingConvId = null;
    });

    const btn = document.createElement('div');
    btn.className = 'deepblue-add-to-folder-btn';
    btn.dataset.dbTip = Lang.t('folders.assign.title');
    btn.setAttribute('role', 'button');
    btn.style.cssText = `
 position: absolute;
 right: 34px;
 top: 50%;
 transform: translateY(-50%);
 display: flex; align-items: center; justify-content: center;
 width: 20px; height: 20px; border-radius: 6px; cursor: pointer;
 color: var(--db-text-secondary); flex-shrink: 0; opacity: 0; transition: opacity 0.15s ease;
 background: inherit;
 z-index: 2;
 `;
    btn.innerHTML = `
 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M3 7C3 5.89543 3.89543 5 5 5H9L11 7H19C20.1046 7 21 7.89543 21 9V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
 </svg>
 `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--db-surface-hover)';
      btn.style.color = 'var(--db-text)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
      btn.style.color = 'var(--db-text-secondary)';
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._openAssignMenu(convId, btn);
    });

    link.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
    });
    link.addEventListener('mouseleave', () => {
      btn.style.opacity = '0';
    });

    link.appendChild(btn);
  },

  _openAssignMenu(convId, anchorEl) {
    const existing = document.getElementById(CONFIG.ids.folderMenu);
    if (existing) existing.remove();

    const folders = this._getFolders();
    const assignments = this._getAssignments();
    const currentFolderId = assignments[convId];

    const menu = document.createElement('div');
    menu.id = CONFIG.ids.folderMenu;
    menu.style.cssText = `
 position: fixed;
 z-index: 999999;
 background: var(--db-surface);
 border: 1px solid var(--db-border);
 border-radius: var(--db-radius-md);
 box-shadow: var(--db-shadow-lg);
 padding: 6px;
 width: 196px;
 max-height: 260px;
 overflow-y: auto;
 font-family: var(--db-font);
 `;
    menu.classList.add('db-scroll');

    const rect = anchorEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 196)}px`;

    if (!folders.length) {
      const empty = document.createElement('div');
      empty.textContent = Lang.t('folders.assign.empty');
      empty.style.cssText = 'font-size: 12px; color: var(--db-text-secondary); padding: 8px; line-height: 1.5;';
      menu.appendChild(empty);
    } else {
      folders.forEach((folder) => {
        const item = document.createElement('button');
        item.style.cssText = this._menuItemStyle() + 'display:flex; align-items:center; gap:8px;';
        const isCurrent = currentFolderId === folder.id;
        item.innerHTML = `
     <span style="width:9px; height:9px; border-radius:3px; background:${escapeHtml(
       folder.color
     )}; flex-shrink:0;"></span>
     <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(
       folder.name
     )}</span>
     ${
       isCurrent
         ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0; color:var(--db-accent);">
       <path d="M5 13L10 18L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
       </svg>`
         : ''
     }
     `;
        item.addEventListener('mouseenter', () => (item.style.background = 'var(--db-surface-sunken)'));
        item.addEventListener('mouseleave', () => (item.style.background = 'none'));
        item.addEventListener('click', () => {
          this._assign(convId, isCurrent ? null : folder.id);
          menu.remove();
        });
        menu.appendChild(item);
      });
    }

    document.body.appendChild(menu);
  },

  _wireGlobalListeners() {
    if (this._globalWired) return;
    this._globalWired = true;
    document.addEventListener('click', (e) => {
      const menu = document.getElementById(CONFIG.ids.folderMenu);
      if (
        menu &&
        !menu.contains(e.target) &&
        !e.target.closest('.deepblue-add-to-folder-btn') &&
        !e.target.closest('.deepblue-folder-more')
      ) {
        menu.remove();
        this._menuOpenFor = null;
      }
    });
  },

  _injectStyles() {
    if (document.getElementById('deepblue-folder-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-folder-styles';
    style.textContent = `
 #${CONFIG.ids.folderSection} button { font-family: inherit; }
 `;
    document.head.appendChild(style);
  },
};
