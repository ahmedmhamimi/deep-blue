// features/tone-selector.js - a draggable "tone" slider injected below the
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
      this._positionThumbLabel();
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

    this._injectSliderStyles();

    const row = this._build();
    composerBody.insertBefore(row, toolbarLine.nextSibling);
    this._wireSendInterception();

    nextFrame().then(() => this._positionThumbLabel());
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
    this._rebuildSlider();
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
        if (!btn || btn.id === CONFIG.ids.exportBtn) return;
        this._injectIntoTextareaIfNeeded(DOM.findTextarea());
      },
      true
    );
  },

  // -- UI ------------------------------------------------------------------

  _injectSliderStyles() {
    if (document.getElementById('deepblue-tone-slider-styles')) return;
    const style = document.createElement('style');
    style.id = 'deepblue-tone-slider-styles';
    style.textContent = `
    .deepblue-tone-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 999px;
      background: var(--deepblue-tone-fill, #e9ecf0);
      cursor: pointer;
      margin: 0;
      outline: none;
    }
    .deepblue-tone-slider::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 999px;
      background: transparent;
    }
    .deepblue-tone-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      background: #3964fe;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.28);
      margin-top: -5.5px;
      cursor: grab;
      transition: transform 0.12s ease;
    }
    .deepblue-tone-slider::-webkit-slider-thumb:active {
      cursor: grabbing;
      transform: scale(1.15);
    }
    .deepblue-tone-slider::-moz-range-track {
      height: 4px;
      border-radius: 999px;
      background: #e9ecf0;
    }
    .deepblue-tone-slider::-moz-range-progress {
      height: 4px;
      border-radius: 999px;
      background: #3964fe;
    }
    .deepblue-tone-slider::-moz-range-thumb {
      width: 15px;
      height: 15px;
      border-radius: 50%;
      background: #3964fe;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.28);
      cursor: grab;
    }
    `;
    document.head.appendChild(style);
  },

  _build() {
    const row = document.createElement('div');
    row.id = CONFIG.ids.toneRow;
    row.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px 18px;
    margin-top: 2px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    `;

    // Icon width is reused below to indent the slider so it lines up
    // directly under the labels row (rather than under the icon too).
    const ICON_COL_WIDTH = 16; // 14px icon + gap rounding

    // -- Row 1: the tone icon + one label per stop, spread edge to edge so
    // each name sits roughly above where the slider lands on that stop.
    const labelsLine = document.createElement('div');
    labelsLine.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const icon = document.createElement('div');
    icon.title = 'Tone of DeepSeek\u2019s response - appended as a visible tag on your message';
    icon.style.cssText = `display:flex; align-items:center; justify-content:center; color:#8e8e93; flex-shrink:0; width:${ICON_COL_WIDTH}px;`;
    icon.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3L14.2 9.3L20.5 11.5L14.2 13.7L12 20L9.8 13.7L3.5 11.5L9.8 9.3L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>
    `;
    labelsLine.appendChild(icon);

    const labelsFlex = document.createElement('div');
    labelsFlex.style.cssText = `
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: 18px;
    padding: 0 7px;
    `;
    labelsLine.appendChild(labelsFlex);
    row.appendChild(labelsLine);
    this._labelsFlex = labelsFlex;

    const addBtn = document.createElement('button');
    addBtn.id = CONFIG.ids.toneAddBtn;
    addBtn.title = 'Add a custom tone';
    addBtn.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
    background: none; border: 1px dashed #c9ccd3; cursor: pointer; color: #8e8e93;
    padding: 0; margin-left: 8px; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    `;
    addBtn.innerHTML = `
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      this._showAddInput(labelsLine, addBtn);
    });
    labelsLine.appendChild(addBtn);
    this._addBtn = addBtn;

    // -- Row 2: the slider, indented by the same amount as the icon column
    // so its 0%/100% ends line up with the first/last labels above it.
    const sliderLine = document.createElement('div');
    sliderLine.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const spacer = document.createElement('div');
    spacer.style.cssText = `flex-shrink: 0; width: ${ICON_COL_WIDTH}px;`;
    sliderLine.appendChild(spacer);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'deepblue-tone-slider';
    slider.step = '1';
    slider.style.cssText = 'flex: 1 1 auto; min-width: 0; touch-action: none;';
    slider.addEventListener('input', () => {
      const tone = this._allTones()[Number(slider.value)];
      if (tone) this._select(tone.id);
    });
    this._wireManualDrag(slider);
    sliderLine.appendChild(slider);
    row.appendChild(sliderLine);
    this._slider = slider;

    this._row = row;
    this._rebuildSlider();
    window.addEventListener('resize', () => this._positionThumbLabel());
    return row;
  },

  // Rebuilds the label strip and the slider's range (min/max/value) to
  // match the current tone list - called on first build and whenever a
  // custom tone is added or removed (which changes how many stops exist).
  // Drives the slider from pointer events directly instead of relying on
  // the browser's native mouse-drag-a-range-thumb behavior. DeepSeek's
  // composer area has its own listeners for things like focus handling and
  // selection prevention; if any of those run first and call
  // preventDefault()/stopPropagation() on mousedown, a native range input
  // can end up completely unable to be dragged even though it still
  // responds to clicks/keyboard. Capturing pointerdown ourselves (capture
  // phase, with stopPropagation) guarantees we see the gesture before any
  // such handler can swallow it, and setPointerCapture keeps the drag
  // tracking correctly even if the cursor moves outside the thin track.
  _wireManualDrag(slider) {
    const setFromClientX = (clientX) => {
      const rect = slider.getBoundingClientRect();
      if (!rect.width) return;
      const min = Number(slider.min) || 0;
      const max = Number(slider.max) || 1;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const stepped = String(Math.round(min + fraction * (max - min)));
      if (stepped !== slider.value) {
        slider.value = stepped;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    slider.addEventListener(
      'pointerdown',
      (e) => {
        e.stopPropagation();
        try {
          slider.setPointerCapture(e.pointerId);
        } catch (_) {
          /* ignore - unsupported or already captured */
        }
        setFromClientX(e.clientX);
      },
      true
    );

    slider.addEventListener('pointermove', (e) => {
      if (e.buttons !== 1) return;
      e.stopPropagation();
      setFromClientX(e.clientX);
    });

    slider.addEventListener('pointerup', (e) => {
      try {
        slider.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    });
  },

  _rebuildSlider() {
    const slider = this._slider;
    const labelsFlex = this._labelsFlex;
    if (!slider || !labelsFlex) return;

    const tones = this._allTones();
    const state = this._getState();
    const index = Math.max(
      0,
      tones.findIndex((t) => t.id === state.selectedId)
    );

    slider.min = '0';
    slider.max = String(tones.length - 1);
    slider.value = String(index);

    labelsFlex.innerHTML = '';
    tones.forEach((tone, i) => {
      labelsFlex.appendChild(this._buildLabelItem(tone, i, tones.length, index));
    });

    this._positionThumbLabel();
  },

  // Absolutely positioned at the same percent-of-track the slider uses
  // (see _positionThumbLabel), rather than laid out with flex
  // space-between - space-between only pins the FIRST/LAST label's edges
  // to the container edges, so every label's actual center (which depends
  // on its own text width) drifts away from where the thumb lands,
  // especially once custom tones with longer names are added. Percent-based
  // absolute placement keeps every label's center matched to its stop.
  _buildLabelItem(tone, i, total, selectedIndex) {
    const isCustom = !CONFIG.tone.presets.some((p) => p.id === tone.id);
    const isSelected = i === selectedIndex;
    const percent = total > 1 ? (i / (total - 1)) * 100 : 0;

    // First/last labels hug the track's ends outward instead of centering
    // (which would push them half off the edge and get clipped).
    let transform = 'translate(-50%, -50%)';
    let leftStyle = `${percent}%`;
    if (i === 0) {
      transform = 'translateY(-50%)';
      leftStyle = '0';
    } else if (i === total - 1) {
      transform = 'translate(-100%, -50%)';
    }

    const item = document.createElement('div');
    item.className = 'deepblue-tone-label-item';
    item.dataset.toneId = tone.id;
    item.dataset.index = String(i);
    item.style.cssText = `
    position: absolute;
    top: 50%;
    left: ${leftStyle};
    transform: ${transform};
    font-size: 12px;
    font-weight: ${isSelected ? '700' : '500'};
    color: ${isSelected ? '#3964fe' : '#8e8e93'};
    white-space: nowrap;
    user-select: none;
    cursor: pointer;
    transition: color 0.15s ease;
    `;
    item.textContent = tone.id === 'none' ? 'Off' : tone.emoji ? `${tone.label} ${tone.emoji}` : tone.label;
    item.title =
      tone.id === 'none' ? 'Click to turn tone tagging off' : `Click to select \u2013 appends "${this._tagText(tone)}" to your message`;

    item.addEventListener('click', () => {
      const slider = this._slider;
      if (slider) {
        slider.value = String(i);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        this._select(tone.id);
      }
    });

    if (isCustom) {
      const remove = document.createElement('span');
      remove.textContent = '\u00d7';
      remove.title = 'Remove this tone';
      remove.style.cssText = `
      display: inline-flex; align-items: center; justify-content: center;
      width: 13px; height: 13px; margin-left: 3px; border-radius: 50%;
      background: #e4e7ed; color: #8e8e93; font-size: 10px; font-weight: 700;
      opacity: 0; transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
      `;
      remove.addEventListener('mouseenter', () => {
        remove.style.background = '#ef4444';
        remove.style.color = '#ffffff';
      });
      remove.addEventListener('mouseleave', () => {
        remove.style.background = '#e4e7ed';
        remove.style.color = '#8e8e93';
      });
      remove.addEventListener('click', (e) => {
        // Stops the label's own click (select-this-tone) from also firing.
        e.stopPropagation();
        this._removeCustomTone(tone.id);
      });
      item.addEventListener('mouseenter', () => (remove.style.opacity = '1'));
      item.addEventListener('mouseleave', () => (remove.style.opacity = '0'));
      item.appendChild(remove);
    }

    return item;
  },

  // Recomputed on every selection change and on window resize: fills the
  // track up to the thumb (via a CSS var read by the injected stylesheet)
  // and re-highlights the matching label above it.
  _positionThumbLabel() {
    const slider = this._slider;
    if (!slider) return;

    const min = Number(slider.min) || 0;
    const max = Number(slider.max) || 1;
    const value = Number(slider.value) || 0;
    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;

    slider.style.setProperty(
      '--deepblue-tone-fill',
      `linear-gradient(to right, #3964fe ${percent}%, #e9ecf0 ${percent}%)`
    );

    if (this._labelsFlex) {
      Array.from(this._labelsFlex.children).forEach((item, i) => {
        const isSelected = i === value;
        item.style.color = isSelected ? '#3964fe' : '#8e8e93';
        item.style.fontWeight = isSelected ? '700' : '500';
      });
    }
  },

  _syncSelectionUI() {
    const tones = this._allTones();
    const state = this._getState();
    const index = Math.max(
      0,
      tones.findIndex((t) => t.id === state.selectedId)
    );
    if (this._slider) this._slider.value = String(index);
    this._positionThumbLabel();
  },

  _showAddInput(labelsLine, addBtn) {
    if (this._addingCustom) return;
    this._addingCustom = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. sarcastic';
    input.maxLength = 24;
    input.style.cssText = `
    width: 100px;
    font-size: 12px;
    font-family: inherit;
    border: 1px solid #3964fe;
    border-radius: 999px;
    padding: 3px 10px;
    outline: none;
    flex-shrink: 0;
    margin-left: 8px;
    `;

    labelsLine.insertBefore(input, addBtn);
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
      if (tone) this._rebuildSlider();
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
