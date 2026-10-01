// features/tone-selector.js - a compact "tone" picker living in the
// composer's main toolbar row. Lets the user pick a response tone (or add
// their own), which gets appended as a short, ALWAYS VISIBLE tag on the
// last line of their outgoing message - e.g. "Tone: Fun 🎉" - right before
// it's sent.
//
// UI shape: a single small chip sits inline with the char counter / copy /
// download buttons (no permanent extra row - a full-width row was tried
// first, but keeping six-plus pills visible at all times ate a whole line
// of the composer for something picked once every so often, and dead
// weight in daily view is a worse trade than one extra click on the rare
// message where the tone changes). Clicking the chip opens a small
// floating popover with the full picker; the chip itself always shows the
// active tone at a glance (its emoji/label, or a neutral icon when off),
// so status is visible without permanent screen real estate cost.
//
// Deliberately never hidden or stripped from the rendered message: what you
// see in the chat log, in exports, and in the actual request DeepSeek
// receives are always the same text. No DOM-hiding tricks, no private-API
// interception - just the same composer text a human could have typed
// themselves, submitted the normal way.
//
// Depends on: config.js, dom.js, store.js (Store), utils.js (uid,
// escapeHtml, nextFrame, setNativeInputValue).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const ToneSelector = {
  _sendListenersWired: false,
  _addingCustom: false,
  _popoverOpen: false,

  ensureInjected() {
    if (document.getElementById(CONFIG.ids.toneRow)) {
      this._syncChip();
      return;
    }

    const sendWrapper = DOM.findSendButtonWrapper();
    const toolbar = sendWrapper?.parentNode;
    if (!toolbar) return;

    const chip = this._buildChip();
    // Sits right after the char counter / context meter, well before the
    // copy / download / send cluster on the trailing edge - flex `order`
    // controls the actual visual position, so where it lands in the DOM
    // here doesn't matter.
    chip.style.order = '-500';
    toolbar.appendChild(chip);
    this._wireSendInterception();
  },

  // -- persistence -------------------------------------------------------

  _getState() {
    const state = Store.getToneState();
    if (!state.customTones) state.customTones = [];
    if (!state.selectedId) state.selectedId = 'none';
    return state;
  },

  _saveState(state) {
    Store.setToneState(state);
  },

  _allTones() {
    return [...CONFIG.tone.presets, ...this._getState().customTones];
  },

  _selectedTone() {
    const state = this._getState();
    return this._allTones().find((t) => t.id === state.selectedId) || CONFIG.tone.presets[0];
  },

  _select(id) {
    const state = this._getState();
    state.selectedId = id;
    this._saveState(state);
    this._syncChip();
    this._rebuildPopoverGrid();
  },

  _addCustomTone(label) {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const state = this._getState();
    const tone = { id: uid(), label: trimmed, emoji: '' };
    state.customTones.push(tone);
    state.selectedId = tone.id;
    this._saveState(state);
    return tone;
  },

  _removeCustomTone(id) {
    const state = this._getState();
    state.customTones = state.customTones.filter((t) => t.id !== id);
    if (state.selectedId === id) state.selectedId = 'none';
    this._saveState(state);
    this._syncChip();
    this._rebuildPopoverGrid();
  },

  // Preset tones (Friendly/Fun/...) show a localized label; custom tones
  // are free text the person typed themselves, so their label is never
  // translated - there's nothing to look up.
  _labelFor(tone) {
    if (tone.id === 'none') return Lang.t('tone.option.off');
    const isPreset = CONFIG.tone.presets.some((p) => p.id === tone.id);
    return isPreset ? Lang.t(`tone.preset.${tone.id}`) : tone.label;
  },

  // -- the tag itself ------------------------------------------------------

  _tagText(tone) {
    if (tone.id === 'none') {
      return Lang.t('tone.tagOff');
    }
    return Lang.t('tone.tag', {
      label: `${this._labelFor(tone)}${tone.emoji ? ' ' + tone.emoji : ''}`,
    });
  },

  // DeepSeek carries a stated tone forward through the rest of a
  // conversation on its own (it's right there in the chat history), so
  // re-appending it on every single message would just be redundant
  // clutter. We only need to say something when the tone actually CHANGES
  // partway through a conversation - including changing it to "Off", which
  // otherwise wouldn't get a tag at all and so could never actually cancel
  // a tone stated earlier in that same conversation.
  //
  // Before the very first message is sent, the URL has no conversation
  // slug yet - there's nothing to key persisted history off of. Using a
  // shared placeholder key there (e.g. "new") would let history bleed
  // between totally unrelated brand-new conversations: if an earlier
  // fresh chat once had a tone active, the NEXT fresh chat would
  // incorrectly inherit that "history" and could wrongly send an "ignore
  // earlier instructions" revert tag despite never having said anything.
  // So: no stable id yet means we always treat this as truly fresh, and we
  // never persist anything under a shared bucket.
  _currentConversationId() {
    return conversationIdFromHref(location.pathname);
  },

  _lastInjectedId() {
    const convId = this._currentConversationId();
    if (!convId) return undefined;
    const map = Store.getToneLastInjected();
    return map[convId];
  },

  _markInjected(toneId) {
    const convId = this._currentConversationId();
    if (!convId) return;
    const map = Store.getToneLastInjected();
    map[convId] = toneId;
    Store.setToneLastInjected(map);
  },

  _needsInjection(tone) {
    const last = this._lastInjectedId();
    if (tone.id === 'none') {
      // Only worth an explicit "Off" tag if we'd previously told the model
      // to use some other tone earlier in THIS conversation. A
      // conversation that has always been "Off" should never get one.
      return last !== undefined && last !== 'none';
    }
    return last !== tone.id;
  },

  // Appends the active tone tag to the composer text, the "real" way (see
  // setNativeInputValue), right before a send actually happens - but only
  // when the tone has changed since we last told the model, for this
  // conversation. No-ops for an empty message.
  _injectIntoTextareaIfNeeded(textarea) {
    if (!textarea) return;

    const tone = this._selectedTone();
    if (!this._needsInjection(tone)) return;

    const current = textarea.value;
    if (!current || !current.trim()) return;

    const tag = this._tagText(tone);
    if (current.includes(tag)) {
      this._markInjected(tone.id);
      return;
    }

    const separator = current.endsWith('\n') ? '\n' : '\n\n';
    setNativeInputValue(textarea, current + separator + tag);
    this._markInjected(tone.id);
  },

  _wireSendInterception() {
    if (this._sendListenersWired) return;
    this._sendListenersWired = true;

    // Capture phase, attached at document: this fires before the event
    // even reaches the textarea/button, which is before DeepSeek's own
    // (delegated, bubble-phase) send handler ever sees it - so by the time
    // that handler reads the composer's value, our tag is already in it.
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        const textarea = DOM.findTextarea();
        if (!textarea || e.target !== textarea) return;
        this._injectIntoTextareaIfNeeded(textarea);
      },
      true
    );

    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest?.(CONFIG.selectors.primaryCircleButton);
        // Skip DeepBlue's own buttons (export/copy-conversation/etc) - they
        // reuse this same class for visual consistency but aren't a real
        // "send" action. See isDeepBlueOwnedElement in utils.js.
        if (!btn || isDeepBlueOwnedElement(btn)) return;
        this._injectIntoTextareaIfNeeded(DOM.findTextarea());
      },
      true
    );
  },

  // -- UI: the collapsed chip ------------------------------------------------

  _sparkleIcon() {
    return `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3L14.2 9.3L20.5 11.5L14.2 13.7L12 20L9.8 13.7L3.5 11.5L9.8 9.3L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>
    `;
  },

  _chevronIcon() {
    return `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    `;
  },

  _buildChip() {
    const row = document.createElement('div');
    // Keep the same element id the rest of the module (and bootstrap's
    // injected-check) looks for, even though it's a single chip now, not
    // a full row - renaming it would be a bigger blast radius than it's
    // worth for an internal id nobody else reads.
    row.id = CONFIG.ids.toneRow;
    row.style.cssText = 'display: inline-flex; align-items: center; flex-shrink: 0;';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'db-tone-chip';
    chip.setAttribute('aria-haspopup', 'true');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePopover(chip);
    });
    row.appendChild(chip);
    this._chip = chip;

    this._row = row;
    this._syncChip();
    return row;
  },

  _syncChip() {
    const chip = this._chip || document.querySelector(`#${CONFIG.ids.toneRow} .db-tone-chip`);
    if (!chip) return;
    this._chip = chip;

    const tone = this._selectedTone();
    const isActive = tone.id !== 'none';
    const label = this._labelFor(tone);
    chip.dataset.active = String(isActive);
    chip.dataset.dbTip = isActive
      ? Lang.t('tone.chip.active.title', { label })
      : Lang.t('tone.chip.off.title');

    chip.innerHTML = `
    <span class="db-tone-chip__icon">${tone.emoji ? tone.emoji : this._sparkleIcon()}</span>
    <span>${isActive ? escapeHtml(label) : Lang.t('tone.chip.label')}</span>
    <span class="db-tone-chip__chevron">${this._chevronIcon()}</span>
    `;
  },

  // -- UI: the popover ---------------------------------------------------

  _togglePopover(anchorBtn) {
    if (this._popoverOpen) this._closePopover();
    else this._openPopover(anchorBtn);
  },

  _openPopover(anchorBtn) {
    this._popoverOpen = true;
    anchorBtn.dataset.open = 'true';

    const popover = document.createElement('div');
    popover.className = 'db-tone-popover';

    const head = document.createElement('div');
    head.className = 'db-tone-popover__head';
    head.innerHTML = `<span class="db-tone-popover__title">${Lang.t('tone.popover.title')}</span>`;
    popover.appendChild(head);

    const hint = document.createElement('div');
    hint.className = 'db-tone-popover__hint';
    hint.textContent = Lang.t('tone.popover.hint');
    popover.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'db-tone-popover__grid db-scroll';
    popover.appendChild(grid);
    this._grid = grid;
    this._rebuildPopoverGrid();

    const footer = document.createElement('div');
    footer.className = 'db-tone-popover__footer';
    footer.appendChild(this._buildAddRow());
    popover.appendChild(footer);
    this._footer = footer;

    document.body.appendChild(popover);
    this._popoverEl = popover;
    this._positionPopover(popover, anchorBtn);

    setTimeout(() => {
      this._outsideHandler = (e) => {
        if (popover.contains(e.target) || anchorBtn.contains(e.target)) return;
        this._closePopover();
      };
      document.addEventListener('click', this._outsideHandler);
    }, 0);

    this._keyHandler = (e) => {
      if (e.key === 'Escape') this._closePopover();
    };
    document.addEventListener('keydown', this._keyHandler);
  },

  _closePopover() {
    this._popoverOpen = false;
    this._addingCustom = false;
    if (this._chip) this._chip.dataset.open = 'false';
    if (this._popoverEl) {
      this._popoverEl.remove();
      this._popoverEl = null;
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

  // Opens upward-and-right-aligned by default (natural for a composer
  // toolbar sitting at the bottom of the screen), flipping to whichever
  // side actually has room, exactly like export/download-menu.js's popover.
  _positionPopover(popover, anchorEl) {
    const anchorRect = anchorEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const gap = 8;
    const margin = 8;

    let top = anchorRect.top - popRect.height - gap;
    let originY = 'bottom';
    if (top < margin) {
      top = anchorRect.bottom + gap;
      originY = 'top';
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));

    let left = anchorRect.left;
    if (left + popRect.width > window.innerWidth - margin) {
      left = anchorRect.right - popRect.width;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.setProperty('--db-tone-origin-x', 'left');
    popover.style.transformOrigin = `left ${originY}`;
  },

  _rebuildPopoverGrid() {
    const grid = this._grid;
    if (!grid) return;

    const tones = this._allTones();
    const state = this._getState();

    grid.innerHTML = '';
    tones.forEach((tone) => grid.appendChild(this._buildOption(tone, tone.id === state.selectedId)));
  },

  _buildOption(tone, isSelected) {
    const isCustom = !CONFIG.tone.presets.some((p) => p.id === tone.id);
    const label = this._labelFor(tone);

    const option = document.createElement('div');
    option.className = 'db-tone-option';
    option.dataset.selected = String(isSelected);
    option.dataset.toneId = tone.id;
    option.dataset.dbTip =
      tone.id === 'none'
        ? Lang.t('tone.option.off.title')
        : Lang.t('tone.option.title', { tag: this._tagText(tone) });

    option.innerHTML = `
    <span class="db-tone-option__emoji">${tone.id === 'none' ? '\u2014' : tone.emoji || '\ud83d\udcac'}</span>
    <span class="db-tone-option__label">${escapeHtml(label)}</span>
    `;

    option.addEventListener('click', () => this._select(tone.id));

    if (isCustom) {
      const remove = document.createElement('span');
      remove.className = 'db-tone-option__remove';
      remove.textContent = '\u00d7';
      remove.dataset.dbTip = Lang.t('tone.remove.title');
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeCustomTone(tone.id);
      });
      option.appendChild(remove);
    }

    return option;
  },

  _buildAddRow() {
    const wrap = document.createElement('div');
    wrap.className = 'db-tone-add-row';

    const addBtn = document.createElement('button');
    addBtn.id = CONFIG.ids.toneAddBtn;
    addBtn.type = 'button';
    addBtn.className = 'db-tone-add-btn';
    addBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
    <span>${Lang.t('tone.add')}</span>
    `;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showAddInput(wrap, addBtn);
    });
    this._addBtn = addBtn;

    wrap.appendChild(addBtn);
    return wrap;
  },

  _showAddInput(wrap, addBtn) {
    if (this._addingCustom) return;
    this._addingCustom = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = Lang.t('tone.add.placeholder');
    input.maxLength = 24;
    input.className = 'db-tone-add-input';

    addBtn.style.display = 'none';
    wrap.appendChild(input);
    input.focus();

    // Removing a still-focused input from the DOM fires its own 'blur'
    // event, which would otherwise re-enter this same commit/cancel logic
    // a second time (e.g. Enter commits and removes the input -> that
    // removal fires blur -> blur handler tries to commit again -> duplicate
    // tone). `settled` makes every path after the first one a no-op.
    let settled = false;

    const cleanup = () => {
      input.removeEventListener('blur', onBlur);
      input.remove();
      addBtn.style.display = 'flex';
      this._addingCustom = false;
    };

    const commit = () => {
      if (settled) return;
      settled = true;
      const tone = this._addCustomTone(input.value);
      cleanup();
      if (tone) {
        this._syncChip();
        this._rebuildPopoverGrid();
      }
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cancel();
    });
    const onBlur = () => {
      if (input.value.trim()) commit();
      else cancel();
    };
    input.addEventListener('blur', onBlur);
  },
};
