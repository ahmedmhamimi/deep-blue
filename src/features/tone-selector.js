// features/tone-selector.js - a single-row "tone" picker injected below the
// composer's bottom toolbar (char counter / export / send row). Lets the
// user pick a response tone (or add their own), which gets appended as a
// short, ALWAYS VISIBLE tag on the last line of their outgoing message -
// e.g. "Tone: Fun 🎉" - right before it's sent.
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

  ensureInjected() {
    if (document.getElementById(CONFIG.ids.toneRow)) {
      this._syncSelectionUI();
      return;
    }

    const sendWrapper = DOM.findSendButtonWrapper();
    const toolbar = sendWrapper?.parentNode;
    // `toolbar` (char count / attach / export / send) and the DeepThink /
    // Search mode-toggle row are actually two children of the SAME single
    // flex line (laid out side by side, one on each edge) - not two
    // stacked rows as they visually appear. Inserting our row as a third
    // child of that flex line just added it to the same line, off to the
    // right. Climbing one level further up gets us to the container that
    // stacks the textarea above that whole toolbar line, which is where a
    // genuinely new row belongs.
    const toolbarLine = toolbar?.parentNode;
    const composerBody = toolbarLine?.parentNode;
    if (!toolbarLine || !composerBody) return;

    const row = this._build();
    composerBody.insertBefore(row, toolbarLine.nextSibling);
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
    this._syncSelectionUI();
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
    this._rebuildPills();
  },

  // -- the tag itself ------------------------------------------------------

  _tagText(tone) {
    if (tone.id === 'none') {
      return 'Tone: Off (ignore any earlier tone instructions - back to your normal, default tone)';
    }
    return `Tone: ${tone.label}${tone.emoji ? ' ' + tone.emoji : ''}`;
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

  // -- UI ------------------------------------------------------------------
  //
  // A single row: a small "Tone" label (so its purpose is obvious at a
  // glance) separated by a thin divider from a horizontally-scrollable
  // strip of pills - Off, each preset, then any custom tones, then a
  // dashed "+" to add another. Exactly one pill is ever visually "active"
  // (solid blue fill) so the current selection is unambiguous. Everything
  // lives in this one row, however many custom tones get added - the pill
  // strip scrolls sideways instead of wrapping to a second line.

  _build() {
    const row = document.createElement('div');
    row.id = CONFIG.ids.toneRow;
    row.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 14px 12px;
    margin-top: 2px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    `;

    // -- Leading label: what this row even is, at a glance. Stays put
    // (doesn't scroll away) even if the pill strip grows long.
    const lead = document.createElement('div');
    lead.title = 'Tone of DeepSeek\u2019s response - appended as a short, visible tag on your message';
    lead.style.cssText = 'display:flex; align-items:center; gap:5px; flex-shrink:0; cursor:default;';
    lead.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:#8e8e93;">
    <path d="M12 3L14.2 9.3L20.5 11.5L14.2 13.7L12 20L9.8 13.7L3.5 11.5L9.8 9.3L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>
    <span style="font-size:11px; font-weight:700; letter-spacing:0.3px; text-transform:uppercase; color:#8e8e93; white-space:nowrap;">Tone</span>
    `;
    row.appendChild(lead);

    const divider = document.createElement('div');
    divider.style.cssText = 'width:1px; height:16px; background:#e5e7eb; flex-shrink:0;';
    row.appendChild(divider);

    // -- Scrollable pill strip.
    const strip = document.createElement('div');
    strip.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 2px;
    `;
    row.appendChild(strip);
    this._strip = strip;

    const addBtn = document.createElement('button');
    addBtn.id = CONFIG.ids.toneAddBtn;
    addBtn.type = 'button';
    addBtn.title = 'Add a custom tone';
    addBtn.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    background: none; border: 1.5px dashed #c9ccd3; cursor: pointer; color: #8e8e93;
    padding: 0; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    `;
    addBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
    `;
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.background = '#eef1ff';
      addBtn.style.color = '#3964fe';
      addBtn.style.borderColor = '#3964fe';
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.background = 'none';
      addBtn.style.color = '#8e8e93';
      addBtn.style.borderColor = '#c9ccd3';
    });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showAddInput(addBtn);
    });
    this._addBtn = addBtn;

    this._row = row;
    this._rebuildPills();
    return row;
  },

  _rebuildPills() {
    const strip = this._strip;
    if (!strip) return;

    const tones = this._allTones();
    const state = this._getState();

    strip.innerHTML = '';
    tones.forEach((tone) => {
      strip.appendChild(this._buildPill(tone, tone.id === state.selectedId));
    });
    strip.appendChild(this._addBtn);
  },

  _buildPill(tone, isSelected) {
    const isCustom = !CONFIG.tone.presets.some((p) => p.id === tone.id);

    const pill = document.createElement('div');
    pill.className = 'deepblue-tone-pill';
    pill.dataset.toneId = tone.id;
    pill.style.cssText = `
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    border: 1.5px solid ${isSelected ? '#3964fe' : '#e9ecf0'};
    background: ${isSelected ? '#3964fe' : '#f5f6f8'};
    color: ${isSelected ? '#ffffff' : '#6c6c72'};
    box-shadow: ${isSelected ? '0 1px 4px rgba(57,100,254,0.35)' : 'none'};
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    `;
    pill.textContent = tone.id === 'none' ? 'Off' : tone.emoji ? `${tone.label} ${tone.emoji}` : tone.label;
    pill.title =
      tone.id === 'none'
        ? 'No tone tag - DeepSeek responds normally'
        : `Click to select \u2013 appends "${this._tagText(tone)}" to your message`;

    pill.addEventListener('mouseenter', () => {
      if (pill.dataset.toneId === this._getState().selectedId) return;
      pill.style.background = '#eef1ff';
      pill.style.color = '#3964fe';
      pill.style.borderColor = '#c7d2fe';
    });
    pill.addEventListener('mouseleave', () => {
      if (pill.dataset.toneId === this._getState().selectedId) return;
      pill.style.background = '#f5f6f8';
      pill.style.color = '#6c6c72';
      pill.style.borderColor = '#e9ecf0';
    });
    pill.addEventListener('click', () => this._select(tone.id));

    if (isCustom) {
      const remove = document.createElement('span');
      remove.textContent = '\u00d7';
      remove.title = 'Remove this tone';
      const baseRemoveBg = isSelected ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.08)';
      remove.style.cssText = `
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; margin-left: 5px; border-radius: 50%;
      background: ${baseRemoveBg}; color: inherit; font-size: 11px; font-weight: 700;
      transition: background 0.15s ease;
      `;
      remove.addEventListener('mouseenter', (e) => {
        e.stopPropagation();
        remove.style.background = '#ef4444';
      });
      remove.addEventListener('mouseleave', (e) => {
        e.stopPropagation();
        remove.style.background = baseRemoveBg;
      });
      remove.addEventListener('click', (e) => {
        // Stops the pill's own click (select-this-tone) from also firing.
        e.stopPropagation();
        this._removeCustomTone(tone.id);
      });
      pill.appendChild(remove);
    }

    return pill;
  },

  _syncSelectionUI() {
    if (this._strip) this._rebuildPills();
  },

  _showAddInput(addBtn) {
    if (this._addingCustom) return;
    this._addingCustom = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. sarcastic';
    input.maxLength = 24;
    input.style.cssText = `
    width: 110px;
    font-size: 12.5px;
    font-family: inherit;
    border: 1.5px solid #3964fe;
    border-radius: 999px;
    padding: 5px 12px;
    outline: none;
    flex-shrink: 0;
    `;

    addBtn.insertAdjacentElement('beforebegin', input);
    addBtn.style.display = 'none';
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
      if (tone) this._rebuildPills();
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
