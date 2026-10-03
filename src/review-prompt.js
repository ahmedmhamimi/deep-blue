// review-prompt.js - asks for a Chrome Web Store review at the right moment,
// in the right way.
//
// THE PSYCHOLOGY (why every number in CONFIG.review is what it is)
//
// WHEN
//  * Never at install. There is no value yet to be grateful for. Asking a
//    stranger for a favour before giving them anything fails reciprocity.
//  * Only after demonstrated value. Every success (PDF/JSON/TXT export, copy,
//    bookmark, new folder, prompt used, tone set) adds weighted points; we wait
//    for a real habit (score >= 8) - the user has now invested effort too, and
//    the endowment/commitment effect makes them care about the tool.
//  * Only after they came BACK (>= 2 distinct active days, >= 2 days since
//    install). Returning on their own is the strongest honest satisfaction
//    signal there is - far better than a single good minute.
//  * Only at a success moment (peak-end rule). People remember the peak and the
//    end of an experience. We ask right after a win, when positive affect is
//    highest, and wait ~2.6 s so the "Copied! / PDF downloaded!" confirmation
//    finishes first - the ask rides the afterglow rather than interrupting it.
//  * Never mid-task. If they are typing a message, we stay silent (flow state
//    is expensive to rebuild and interruption breeds resentment).
//
// HOW
//  * Non-modal corner card, not a blocker: it is an invitation, never a gate,
//    so people don't feel their autonomy is threatened (reactance).
//  * Two small steps instead of one big ask (foot-in-the-door): first a
//    one-tap star rating - trivial effort, and it makes them state a
//    positive attitude out loud - then the review request, which is now
//    consistent with what they just said (commitment & consistency).
//  * Honest and fair: 4-5 stars -> invited to review on the store. 1-3 stars ->
//    invited to tell us what went wrong (support tab), with a clearly visible
//    link to leave a public review anyway. Nobody is blocked from reviewing.
//    No incentives, no pre-filled ratings, nothing manipulative.
//  * Autonomy: "Maybe later" and "Don't ask again" are always one tap away.
//    Being allowed to say no makes a yes much more likely, and respects them.
//  * Restraint: at most 3 asks ever, >= 7 days apart (7d, then 21d backoff).
//    Rate it / dislike it / "don't ask again" -> never ask again. An ask that
//    is simply ignored (auto-fades after 40 s) is not counted as a refusal.
//
// Depends on: ui-kit.js, i18n.js, config.js, dom.js (findTextarea).

'use strict';

const ReviewPrompt = {
  _HOST_ID: 'deepblue-review-host',
  _shownThisPage: false,
  _open: false,
  _timer: null,
  _inited: false,

  init() {
    this._inited = true;
  },

  _dayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  async _load() {
    const cfg = CONFIG.review;
    let state = await UiKit.storageGet(cfg.stateKey);
    if (!state || typeof state !== 'object') {
      // Existing 1.1 users upgrading never had an install record: their
      // clock starts now, so they are never asked on the day they update.
      state = { installedAt: Date.now(), score: 0, activeDays: [], asks: 0, status: 'pending', nextEligibleAt: 0 };
    }
    state.activeDays = Array.isArray(state.activeDays) ? state.activeDays : [];
    return state;
  },

  _save(state) {
    return UiKit.storageSet(CONFIG.review.stateKey, state);
  },

  // Called from every feature's success path. Cheap, never throws.
  async track(type) {
    try {
      const cfg = CONFIG.review;
      const state = await this._load();
      if (state.status !== 'pending') return;

      state.score += cfg.weights[type] || 1;
      const day = this._dayKey();
      if (!state.activeDays.includes(day)) state.activeDays = [...state.activeDays, day].slice(-30);
      await this._save(state);

      this._type = type;
      if (this._isEligible(state)) this._schedule(type);
    } catch (err) {
      console.debug(`${BRAND_NAME}: review track failed`, err);
    }
  },

  _isEligible(state) {
    const cfg = CONFIG.review;
    const DAY = 86400000;
    return (
      state.status === 'pending' &&
      state.asks < cfg.maxAsks &&
      Date.now() >= (state.nextEligibleAt || 0) &&
      Date.now() - state.installedAt >= cfg.minDaysSinceInstall * DAY &&
      state.score >= cfg.minScore &&
      state.activeDays.length >= cfg.minActiveDays
    );
  },

  _schedule(type) {
    if (this._shownThisPage || this._open || this._timer) return;
    this._timer = setTimeout(async () => {
      this._timer = null;
      await this._maybeShow(type);
    }, CONFIG.review.settleDelayMs);
  },

  _isUserBusy() {
    if (document.visibilityState !== 'visible') return true;
    if (document.getElementById(Welcome._HOST_ID)) return true;
    const ta = DOM.findTextarea();
    // Typing or holding a draft = mid-task. Stay out of the way.
    if (ta && ta.value && ta.value.trim().length > 0) return true;
    return false;
  },

  async _maybeShow(type) {
    if (this._shownThisPage || this._open || this._isUserBusy()) return;

    // Re-read right before showing: another tab may have just asked.
    const state = await this._load();
    if (!this._isEligible(state)) return;
    const gap = CONFIG.review.minGapBetweenAsksDays * 86400000;
    if (state.lastAskAt && Date.now() - state.lastAskAt < Math.min(gap, 60000)) return;

    state.asks += 1;
    state.lastAskAt = Date.now();
    await this._save(state);

    this._shownThisPage = true;
    this._show(type);
  },

  // -- outcomes -----------------------------------------------------------

  async _finish(outcome) {
    const cfg = CONFIG.review;
    const state = await this._load();
    const DAY = 86400000;
    if (outcome === 'reviewed' || outcome === 'unhappy' || outcome === 'never') {
      state.status = outcome === 'reviewed' ? 'completed' : 'declined';
    } else if (outcome === 'ignored') {
      // Not a refusal: give the ask back and try again in a few days.
      state.asks = Math.max(0, state.asks - 1);
      state.nextEligibleAt = Date.now() + 3 * DAY;
    } else {
      // 'later': back off progressively (7 days, then 21).
      const idx = Math.min(Math.max(state.asks - 1, 0), cfg.snoozeDays.length - 1);
      state.nextEligibleAt = Date.now() + cfg.snoozeDays[idx] * DAY;
    }
    await this._save(state);
  },

  _openUrl(url) {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.debug(`${BRAND_NAME}: could not open ${url}`, err);
    }
  },

  // -- UI -------------------------------------------------------------------

  _show(type) {
    this._open = true;
    Theme.sync();
    Lang.sync();

    const t = (k, v) => escapeHtml(Lang.t(k, v));
    const { host, root } = UiKit.createHost(this._HOST_ID);
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    const ctx = type === 'export' ? 'review.ctx.export' : 'review.ctx.default';
    const STAR =
      '<path d="M12 2.6l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.67 6.1 20.77l1.13-6.57L2.45 9.54l6.6-.96z"/>';

    root.innerHTML = `
      <style>${UiKit.baseCss}${this._css()}</style>
      <div class="dock">
        <section class="card" role="dialog" aria-live="polite" aria-labelledby="rv-title">
          <div class="topline"></div>
          <button class="x" type="button" aria-label="${t('review.close')}">${UiKit.icons.close}</button>
          <div class="viewport"><div class="view"></div></div>
        </section>
      </div>`;

    host.style.pointerEvents = 'none';
    document.documentElement.appendChild(host);

    const card = root.querySelector('.card');
    const viewport = root.querySelector('.viewport');
    const view = root.querySelector('.view');
    let rating = 0;
    let closed = false;
    let interacted = false;
    let idleTimer = null;

    const starsHtml = (n, interactive) =>
      [1, 2, 3, 4, 5]
        .map(
          (i) => `<button class="star ${i <= n ? 'on' : ''}" type="button" ${
            interactive
              ? `role="radio" aria-checked="false" aria-label="${t('review.star', { n: i })}" data-i="${i}" tabindex="${i === 1 ? 0 : -1}"`
              : 'tabindex="-1" aria-hidden="true"'
          }><svg viewBox="0 0 24 24" width="100%" height="100%">${STAR}</svg></button>`
        )
        .join('');

    // Smoothly resizes the card when the stage content changes.
    const swap = (html, after) => {
      const from = viewport.offsetHeight;
      viewport.style.height = from + 'px';
      view.classList.add('leaving');
      setTimeout(() => {
        view.classList.remove('leaving');
        view.innerHTML = html;
        view.classList.add('entering');
        const to = view.offsetHeight;
        viewport.style.height = to + 'px';
        requestAnimationFrame(() => view.classList.remove('entering'));
        setTimeout(() => (viewport.style.height = ''), 420);
        after && after();
      }, 170);
    };

    const closeOutcome = () => (rating && rating <= 3 ? 'unhappy' : 'later');

    const dismiss = (outcome, delay = 0) => {
      if (closed) return;
      closed = true;
      clearTimeout(idleTimer);
      document.removeEventListener('keydown', onKey, true);
      this._finish(outcome);
      setTimeout(() => {
        card.classList.add('out');
        setTimeout(() => {
          host.remove();
          this._open = false;
        }, 380);
      }, delay);
    };

    // -- stage 1: stars -------------------------------------------------
    const stage1 = () => `
      <div class="head">
        <img class="mini" src="${iconUrl}" alt="" draggable="false">
        <span class="ctx"><span class="ok">${UiKit.icons.check}</span>${t(ctx)}</span>
      </div>
      <h2 id="rv-title">${t('review.title')}</h2>
      <p class="sub">${t('review.subtitle')}</p>
      <div class="stars" role="radiogroup" aria-label="${t('review.title')}">${starsHtml(0, true)}</div>
      <div class="label" aria-live="polite"><span class="label-text">&nbsp;</span></div>
      <div class="foot">
        <button class="link later" type="button">${t('review.later')}</button>
        <span class="sep" aria-hidden="true"></span>
        <button class="link never" type="button">${t('review.never')}</button>
      </div>`;

    const bindStage1 = () => {
      const starsEl = view.querySelector('.stars');
      const stars = [...starsEl.querySelectorAll('.star')];
      const labelEl = view.querySelector('.label-text');
      let lastLabel = '';

      const paint = (n) => {
        stars.forEach((s, i) => {
          s.classList.toggle('on', i < n);
          s.style.setProperty('--i', i);
        });
        const txt = n ? Lang.t(`review.label.${n}`) : '';
        if (txt !== lastLabel) {
          lastLabel = txt;
          labelEl.classList.remove('show');
          void labelEl.offsetWidth;
          labelEl.textContent = txt || '\u00a0';
          labelEl.dataset.n = n;
          if (txt) labelEl.classList.add('show');
        }
      };

      const commit = (n) => {
        if (rating) return;
        rating = n;
        interacted = true;
        paint(n);
        stars.forEach((s, i) => {
          s.disabled = true;
          s.setAttribute('aria-checked', i + 1 === n ? 'true' : 'false');
          if (i < n) {
            s.style.setProperty('--w', `${i * 70}ms`);
            s.classList.add('pop');
          }
        });
        if (n >= 4) {
          const r = starsEl.getBoundingClientRect();
          setTimeout(
            () => UiKit.confetti(root, { x: r.left + r.width / 2, y: r.top + r.height / 2, count: n === 5 ? 70 : 40, spread: 1.9, power: 0.7 }),
            300
          );
        }
        setTimeout(() => (n >= 4 ? stageHappy() : stageSad()), 900);
      };

      stars.forEach((s, i) => {
        s.addEventListener('mouseenter', () => !rating && paint(i + 1));
        s.addEventListener('focus', () => !rating && paint(i + 1));
        s.addEventListener('click', () => commit(i + 1));
      });
      starsEl.addEventListener('mouseleave', () => !rating && paint(0));
      starsEl.addEventListener('keydown', (e) => {
        const cur = stars.indexOf(root.activeElement);
        let next = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(4, cur + 1);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, cur - 1);
        if (next >= 0) {
          e.preventDefault();
          stars.forEach((s, i) => (s.tabIndex = i === next ? 0 : -1));
          stars[next].focus();
        }
      });

      view.querySelector('.later').addEventListener('click', () => dismiss('later'));
      view.querySelector('.never').addEventListener('click', () => dismiss('never'));
    };

    // -- stage 2a: happy -> store review ---------------------------------
    const stageHappy = () => {
      swap(
        `
        <div class="done-stars" aria-hidden="true">${starsHtml(rating, false)}</div>
        <h2 id="rv-title">${t('review.happy.title')}</h2>
        <p class="sub">${t('review.happy.body')}</p>
        <button class="cta" type="button"><span>${t('review.happy.cta')}</span>${UiKit.icons.external}</button>
        <div class="foot center"><button class="link later" type="button">${t('review.later')}</button></div>`,
        () => {
          view.querySelector('.cta').addEventListener('click', () => {
            this._openUrl(CONFIG.store.reviewsUrl);
            thanks('reviewed');
          });
          view.querySelector('.later').addEventListener('click', () => dismiss('later'));
          view.querySelector('.cta').focus({ preventScroll: true });
        }
      );
    };

    // -- stage 2b: unhappy -> private feedback, public review still open --
    const stageSad = () => {
      swap(
        `
        <h2 id="rv-title">${t('review.sad.title')}</h2>
        <p class="sub">${t('review.sad.body')}</p>
        <button class="cta neutral" type="button"><span>${t('review.sad.cta')}</span>${UiKit.icons.external}</button>
        <div class="foot center"><button class="link alt" type="button">${t('review.sad.alt')}</button></div>`,
        () => {
          view.querySelector('.cta').addEventListener('click', () => {
            this._openUrl(CONFIG.store.supportUrl);
            thanks('unhappy');
          });
          view.querySelector('.alt').addEventListener('click', () => {
            this._openUrl(CONFIG.store.reviewsUrl);
            thanks('reviewed');
          });
          view.querySelector('.cta').focus({ preventScroll: true });
        }
      );
    };

    const thanks = (outcome) => {
      swap(
        `<div class="thanks"><span class="heart">${UiKit.icons.heart}</span><h2 id="rv-title">${t('review.thanks')}</h2></div>`
      );
      dismiss(outcome, 1900);
    };

    // -- wiring -----------------------------------------------------------
    const onKey = (e) => {
      if (e.key === 'Escape' && root.contains(root.activeElement)) {
        e.stopPropagation();
        dismiss(closeOutcome());
      }
    };
    document.addEventListener('keydown', onKey, true);
    root.querySelector('.x').addEventListener('click', () => dismiss(closeOutcome()));

    // Ignored != refused: if nobody touches the card for 40 s (and the
    // pointer isn't over it) it fades away quietly and the ask isn't spent.
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => !interacted && dismiss('ignored'), 40000);
    };
    card.addEventListener('mouseenter', () => clearTimeout(idleTimer));
    card.addEventListener('mouseleave', () => !interacted && armIdle());
    card.addEventListener('focusin', () => { interacted = true; clearTimeout(idleTimer); });
    armIdle();

    view.innerHTML = stage1();
    bindStage1();
    viewport.style.height = '';
  },

  _css() {
    return `
    .dock { position: fixed; right: 24px; bottom: 24px; width: 372px; max-width: calc(100vw - 24px); pointer-events: none; }
    .card { position: relative; pointer-events: auto; overflow: hidden; border-radius: 22px;
      background: var(--surface); color: var(--text); border: 1px solid var(--border); box-shadow: var(--shadow-toast);
      transform-origin: 100% 100%;
      animation: dockIn 640ms var(--spring) both; }
    .card.out { animation: dockOut 380ms cubic-bezier(.4,0,1,1) forwards; }
    .topline { height: 3px; background: var(--grad); transform-origin: left; animation: line 900ms 200ms var(--ease) both; }
    .x { position: absolute; top: 13px; right: 12px; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
      color: var(--text-3); transition: background 150ms ease, color 150ms ease, transform 220ms var(--spring); z-index: 2; }
    .x:hover { background: var(--surface-2); color: var(--text); transform: rotate(90deg); }
    .viewport { overflow: hidden; transition: height 380ms var(--ease); }
    .view { padding: 16px 20px 16px; transition: opacity 170ms ease, transform 170ms ease; }
    .view.leaving { opacity: 0; transform: translateY(-6px); }
    .view.entering { opacity: 0; transform: translateY(8px); transition: none; }

    .head { display: flex; align-items: center; gap: 9px; padding-right: 30px; margin-bottom: 12px; }
    .mini { width: 26px; height: 26px; border-radius: 8px; box-shadow: 0 0 0 1px var(--border); }
    .ctx { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-2); }
    .ok { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--success);
      animation: okPop 460ms 380ms var(--spring) both; }
    .ok svg { width: 11px; height: 11px; }

    h2 { margin: 0; font-size: 17px; line-height: 1.25; font-weight: 700; letter-spacing: -.015em; color: var(--text); }
    .sub { margin: 5px 0 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }

    .stars { display: flex; justify-content: center; gap: 6px; margin: 16px 0 0; }
    .star { width: 40px; height: 40px; padding: 4px; border-radius: 12px; color: var(--surface-3);
      transition: transform 260ms var(--spring), color 140ms ease, filter 200ms ease; }
    .star svg { display: block; fill: currentColor; transition: filter 200ms ease; }
    .star.on { color: transparent; }
    .star.on svg { fill: #ffb81f; filter: drop-shadow(0 3px 6px rgba(255,154,26,.45)); }
    .stars .star:hover, .stars .star:focus-visible { transform: translateY(-2px) scale(1.14); }
    .star:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .star:disabled { cursor: default; }
    .star.pop { animation: starPop 520ms var(--w, 0ms) var(--spring) both; }

    .label { height: 20px; margin: 6px 0 2px; text-align: center; }
    .label-text { display: inline-block; font-size: 13px; font-weight: 650; color: #e08a00; opacity: 0; }
    :host([data-theme="dark"]) .label-text { color: #ffb84a; }
    .label-text[data-n="1"], .label-text[data-n="2"] { color: var(--text-2); }
    :host([data-theme="dark"]) .label-text[data-n="1"], :host([data-theme="dark"]) .label-text[data-n="2"] { color: var(--text-2); }
    .label-text.show { animation: labelIn 240ms var(--ease) forwards; }

    .foot { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; }
    .foot.center { margin-top: 10px; }
    .sep { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); opacity: .6; }
    .link { padding: 6px 8px; border-radius: 8px; font-size: 12.5px; font-weight: 550; color: var(--text-3); transition: color 150ms ease, background 150ms ease; }
    .link:hover { color: var(--text); background: var(--surface-2); }
    .link.alt { color: var(--accent); }
    :host([data-theme="dark"]) .link.alt, :host([data-theme="dark"]) .link.alt:hover { color: #9db4ff; }
    .link.alt:hover { background: rgba(var(--accent-rgb), .1); color: var(--accent); }

    .done-stars { display: flex; gap: 3px; margin-bottom: 10px; }
    .done-stars .star { width: 22px; height: 22px; padding: 0; }
    .done-stars .star.on svg { filter: drop-shadow(0 2px 4px rgba(255,154,26,.4)); }

    .cta { position: relative; overflow: hidden; width: 100%; height: 46px; margin-top: 16px; border-radius: 13px;
      display: inline-flex; align-items: center; justify-content: center; gap: 9px;
      font-size: 14.5px; font-weight: 650; color: #fff; background: var(--grad);
      box-shadow: 0 10px 22px -8px rgba(var(--accent-rgb), .6), 0 1px 0 rgba(255,255,255,.3) inset;
      transition: transform 200ms var(--spring), box-shadow 220ms ease, filter 200ms ease; }
    .cta::after { content: ""; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.4), transparent);
      transform: skewX(-18deg) translateX(-120%); animation: shimmer 1000ms 500ms ease-out 1 both; }
    .cta:hover { transform: translateY(-1px); filter: brightness(1.06); }
    .cta:active { transform: scale(.98); }
    .cta.neutral { background: var(--text); color: var(--surface); box-shadow: 0 8px 18px -8px rgba(0,0,0,.4); }
    .cta.neutral::after { display: none; }
    .cta:focus-visible { outline: 2px solid #fff; outline-offset: -4px; box-shadow: 0 0 0 3px var(--accent); }

    .thanks { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 0 12px; }
    .heart { color: #ef4466; display: grid; animation: heart 900ms var(--spring) both; filter: drop-shadow(0 6px 10px rgba(239,68,102,.4)); }

    @media (max-width: 520px) {
      .dock { right: 12px; left: 12px; bottom: 12px; width: auto; max-width: none; }
    }
    @keyframes dockIn { from { opacity: 0; transform: translateY(28px) scale(.94); } to { opacity: 1; transform: none; } }
    @keyframes dockOut { to { opacity: 0; transform: translateY(16px) scale(.96); } }
    @keyframes line { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes okPop { from { transform: scale(0); } to { transform: scale(1); } }
    @keyframes labelIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes starPop { 0% { transform: scale(1); } 45% { transform: scale(1.35) rotate(-8deg); } 100% { transform: scale(1); } }
    @keyframes shimmer { to { transform: skewX(-18deg) translateX(520%); } }
    @keyframes heart { 0% { transform: scale(0); } 55% { transform: scale(1.3); } 100% { transform: scale(1); } }
    `;
  },
};
