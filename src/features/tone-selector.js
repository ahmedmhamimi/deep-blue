// features/tone-selector.js - a segmented "tone" slider injected above the
// composer toolbar (char counter / export / send row). Lets the user pick a
// response tone (or add their own), which gets appended as a short, ALWAYS
// VISIBLE tag on the last line of their outgoing message - e.g.
// "Tone: Fun 🎉" - right before it's sent.
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
      this._positionHighlight();
      return;
    }

    const sendWrapper = DOM.findSendButtonWrapper();
    const toolbar = sendWrapper?.parentNode;
    if (!toolbar || !toolbar.parentNode) return;

    const row = this._build();
    toolbar.parentNode.insertBefore(row, toolbar);
    this._wireSendInterception();

    nextFrame().then(() => this._positionHighlight());
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
    this._rebuildTrack();
  },

  // -- the tag itself ------------------------------------------------------

  _tagText(tone) {
    return `Tone: ${tone.label}${tone.emoji ? ' ' + tone.emoji : ''}`;
  },

  // Appends the active tone tag to the composer text, the "real" way (see
  // setNativeInputValue), right before a send actually happens. No-ops for
  // "Off", for an empty message, or if the tag is somehow already there.
  _injectIntoTextareaIfNeeded(textarea) {
    if (!textarea) return;
    const state = this._getState();
    if (state.selectedId === 'none') return;

    const tone = this._selectedTone();
    const tag = this._tagText(tone);
    const current = textarea.value;
    if (!current || !current.trim() || current.includes(tag)) return;

    const separator = current.endsWith('\n') ? '\n' : '\n\n';
    setNativeInputValue(textarea, current + separator + tag);
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
        if (!btn || btn.id === CONFIG.ids.exportBtn) return;
        this._injectIntoTextareaIfNeeded(DOM.findTextarea());
      },
      true
    );
  },

  // -- UI ------------------------------------------------------------------

  _build() {
    const row = document.createElement('div');
    row.id = CONFIG.ids.toneRow;
    row.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 2px 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    `;

    const icon = document.createElement('div');
    icon.title = 'Tone of DeepSeek\u2019s response - appended as a visible tag on your message';
    icon.style.cssText =
      'display:flex; align-items:center; justify-content:center; color:#8e8e93; flex-shrink:0;';
    icon.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3L14.2 9.3L20.5 11.5L14.2 13.7L12 20L9.8 13.7L3.5 11.5L9.8 9.3L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>
    `;
    row.appendChild(icon);

    const track = document.createElement('div');
    track.id = CONFIG.ids.toneTrack;
    track.style.cssText = `
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: #f5f6f8;
    border: 1px solid #e9ecf0;
    border-radius: 999px;
    padding: 3px;
    flex-wrap: nowrap;
    overflow-x: auto;
    max-width: 100%;
    scrollbar-width: none;
    `;
    row.appendChild(track);
    this._track = track;

    const addBtn = document.createElement('button');
    addBtn.id = CONFIG.ids.toneAddBtn;
    addBtn.title = 'Add a custom tone';
    addBtn.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
    background: none; border: 1px dashed #c9ccd3; cursor: pointer; color: #8e8e93;
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
      this._showAddInput(row, addBtn);
    });
    row.appendChild(addBtn);
    this._addBtn = addBtn;

    this._row = row;
    this._rebuildTrack();
    window.addEventListener('resize', () => this._positionHighlight());
    return row;
  },

  _rebuildTrack() {
    const track = this._track || document.getElementById(CONFIG.ids.toneTrack);
    if (!track) return;
    track.innerHTML = '';

    const highlight = document.createElement('div');
    highlight.id = CONFIG.ids.toneHighlight;
    highlight.style.cssText = `
    position: absolute;
    top: 3px;
    left: 3px;
    height: calc(100% - 6px);
    width: 0;
    background: #ffffff;
    border-radius: 999px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.10);
    transition: left 0.2s cubic-bezier(0.4, 0, 0.2, 1), width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 0;
    `;
    track.appendChild(highlight);
    this._highlight = highlight;

    const state = this._getState();
    this._allTones().forEach((tone) => {
      track.appendChild(this._buildSegment(tone, state.selectedId === tone.id));
    });

    nextFrame().then(() => this._positionHighlight());
  },

  _buildSegment(tone, isSelected) {
    const isCustom = !CONFIG.tone.presets.some((p) => p.id === tone.id);

    const seg = document.createElement('div');
    seg.className = 'deepblue-tone-segment';
    seg.dataset.toneId = tone.id;
    seg.style.cssText = `
    position: relative;
    z-index: 1;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    color: ${isSelected ? '#3964fe' : '#6c6c72'};
    transition: color 0.15s ease;
    `;
    seg.textContent = tone.emoji ? `${tone.label} ${tone.emoji}` : tone.label;
    seg.title = tone.id === 'none' ? 'No tone tag added' : `Appends "${this._tagText(tone)}" to your message`;

    seg.addEventListener('mouseenter', () => {
      if (seg.dataset.toneId !== this._getState().selectedId) seg.style.color = '#1d1d1f';
    });
    seg.addEventListener('mouseleave', () => {
      if (seg.dataset.toneId !== this._getState().selectedId) seg.style.color = '#6c6c72';
    });
    seg.addEventListener('click', () => this._select(tone.id));

    if (isCustom) {
      const remove = document.createElement('span');
      remove.textContent = '\u00d7';
      remove.title = 'Remove this tone';
      remove.style.cssText = `
      position: absolute; top: -5px; right: -4px; width: 15px; height: 15px;
      border-radius: 50%; background: #c9ccd3; color: #ffffff; font-size: 11px; font-weight: 700;
      line-height: 15px; text-align: center; opacity: 0; transition: opacity 0.15s ease;
      `;
      remove.addEventListener('mouseenter', () => (remove.style.background = '#ef4444'));
      remove.addEventListener('mouseleave', () => (remove.style.background = '#c9ccd3'));
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeCustomTone(tone.id);
      });
      seg.addEventListener('mouseenter', () => (remove.style.opacity = '1'));
      seg.addEventListener('mouseleave', () => (remove.style.opacity = '0'));
      seg.appendChild(remove);
    }

    return seg;
  },

  _syncSelectionUI() {
    const track = this._track || document.getElementById(CONFIG.ids.toneTrack);
    if (!track) return;
    const selectedId = this._getState().selectedId;
    track.querySelectorAll('.deepblue-tone-segment').forEach((seg) => {
      seg.style.color = seg.dataset.toneId === selectedId ? '#3964fe' : '#6c6c72';
    });
    this._positionHighlight();
  },

  _positionHighlight() {
    const track = this._track || document.getElementById(CONFIG.ids.toneTrack);
    const highlight = this._highlight || document.getElementById(CONFIG.ids.toneHighlight);
    if (!track || !highlight) return;

    const selectedId = this._getState().selectedId;
    const seg = track.querySelector(`.deepblue-tone-segment[data-tone-id="${selectedId}"]`);
    if (!seg) return;

    highlight.style.left = `${seg.offsetLeft}px`;
    highlight.style.width = `${seg.offsetWidth}px`;
  },

  _showAddInput(row, addBtn) {
    if (this._addingCustom) return;
    this._addingCustom = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. sarcastic';
    input.maxLength = 24;
    input.style.cssText = `
    width: 130px;
    font-size: 12.5px;
    font-family: inherit;
    border: 1px solid #3964fe;
    border-radius: 999px;
    padding: 5px 12px;
    outline: none;
    flex-shrink: 0;
    `;

    row.insertBefore(input, addBtn);
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
      if (tone) this._rebuildTrack();
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
