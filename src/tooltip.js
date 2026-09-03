// tooltip.js - one shared, nicely-styled tooltip for every DeepBlue
// control, replacing the browser's native `title` popup (which is slow to
// appear, unstyled, and clips long text awkwardly).
//
// Any element with a `data-db-tip="..."` attribute gets a floating label
// on hover/focus: a short delay before showing (so quickly passing over
// several controls doesn't flash a tooltip for each one), instant hide,
// smart placement that flips above/below to stay on screen.
//
// Single delegated listener pair on `document`, so features never need to
// wire anything themselves - just set the attribute when building an
// element and this picks it up automatically, including on elements added
// long after this file has loaded.
//
// Depends on: nothing.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array.

'use strict';

const Tooltip = {
  _el: null,
  _showTimer: null,
  _target: null,
  _wired: false,
  _showDelayMs: 350,

  init() {
    if (this._wired) return;
    this._wired = true;

    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest?.('[data-db-tip]');
      if (!target || target === this._target) return;
      this._scheduleShow(target);
    });

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest?.('[data-db-tip]');
      if (!target || target !== this._target) return;
      // Moving between a target and its own descendant shouldn't count as
      // leaving it - only actually leaving the whole element hides.
      if (e.relatedTarget && target.contains(e.relatedTarget)) return;
      this._hide();
    });

    document.addEventListener(
      'focusin',
      (e) => {
        const target = e.target.closest?.('[data-db-tip]');
        if (target) this._show(target);
      },
      true
    );

    document.addEventListener(
      'focusout',
      (e) => {
        const target = e.target.closest?.('[data-db-tip]');
        if (target === this._target) this._hide();
      },
      true
    );

    // A tooltip pointing at something that just got clicked (e.g. a
    // toggle whose position/label is about to change) is more confusing
    // than helpful hanging around - and any open popover should take
    // visual priority.
    document.addEventListener('mousedown', () => this._hide());
    window.addEventListener('scroll', () => this._hide(), true);
    window.addEventListener('resize', () => this._hide());
  },

  _scheduleShow(target) {
    clearTimeout(this._showTimer);
    this._showTimer = setTimeout(() => this._show(target), this._showDelayMs);
  },

  _show(target) {
    const text = target.getAttribute('data-db-tip');
    if (!text) return;

    clearTimeout(this._showTimer);
    this._target = target;

    if (!this._el) {
      this._el = document.createElement('div');
      this._el.className = 'db-tooltip';
      this._el.setAttribute('role', 'tooltip');
      document.body.appendChild(this._el);
    }

    this._el.textContent = text;
    this._el.classList.add('db-tooltip--visible');
    // Measure after the text is in place but before deciding placement.
    requestAnimationFrame(() => {
      if (this._target === target) this._position(target);
    });
  },

  _position(target) {
    if (!this._el) return;
    const rect = target.getBoundingClientRect();
    const tipRect = this._el.getBoundingClientRect();
    const gap = 9;
    const margin = 8;

    let top = rect.top - tipRect.height - gap;
    let placement = 'top';
    if (top < margin) {
      top = rect.bottom + gap;
      placement = 'bottom';
    }

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));

    this._el.style.top = `${top}px`;
    this._el.style.left = `${left}px`;
    this._el.dataset.placement = placement;
  },

  _hide() {
    clearTimeout(this._showTimer);
    this._target = null;
    if (this._el) this._el.classList.remove('db-tooltip--visible');
  },
};
