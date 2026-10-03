// welcome.js - the one-time post-install splash.
//
// Shown exactly once, on the DeepSeek page the installer is sent to
// (background.js sets a "welcome pending" flag, then takes them there).
//
// Design intent - every motion has a job:
//   * scrim fade + card rise ........ focus: the page recedes, one thing matters
//   * logo spring + ripple rings .... brand: "deep" water, DeepBlue's idea
//   * check badge + tick draw ....... confirmation: it WORKED
//   * confetti (synced to the tick) . reward: the celebration lands with the proof
//   * staggered feature tiles ....... reading order: eye is led top-left to bottom-right
//   * one shimmer on the button ..... affordance: this is the next step
// Everything is skipped (final state shown instantly) under reduced motion.
//
// Depends on: ui-kit.js, i18n.js (Lang), utils.js (escapeHtml).

'use strict';

const Welcome = {
  _HOST_ID: 'deepblue-welcome-host',
  _open: false,

  async maybeShow() {
    // Hidden/background tabs wait until they're actually in front of the
    // person, so the splash is never "used up" on a tab nobody is looking at.
    if (document.visibilityState !== 'visible') {
      document.addEventListener(
        'visibilitychange',
        () => document.visibilityState === 'visible' && this.maybeShow(),
        { once: true }
      );
      return;
    }

    // The background worker hands the claim to exactly one tab (several
    // DeepSeek tabs are reloaded on install) and clears the flag atomically.
    let claimed = false;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'deepblue:claim-welcome' });
      claimed = !!res?.claimed;
    } catch (err) {
      return;
    }
    if (!claimed) return;

    // Let DeepSeek paint first so the splash arrives over a settled page.
    setTimeout(() => this.show(), 650);
  },

  show() {
    if (this._open) return;
    this._open = true;
    Theme.sync();
    Lang.sync();

    const t = (k) => escapeHtml(Lang.t(k));
    const { host, root } = UiKit.createHost(this._HOST_ID);
    const iconUrl = chrome.runtime.getURL('icons/icon128.png');

    const features = [
      { icon: 'search', hue: '57,100,254', k: 'f1' },
      { icon: 'folder', hue: '249,115,22', k: 'f2' },
      { icon: 'bookmark', hue: '108,92,231', k: 'f3' },
      { icon: 'export', hue: '34,197,94', k: 'f4' },
    ];

    root.innerHTML = `
      <style>${UiKit.baseCss}${this._css()}</style>
      <div class="scrim"></div>
      <div class="stage">
        <section class="card" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="sub">
          <div class="hero" aria-hidden="true">
            <div class="aurora"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i></div>
            <div class="sheen"></div>
          </div>
          <button class="x" type="button" aria-label="${t('review.close')}">${UiKit.icons.close}</button>

          <div class="mark" aria-hidden="true">
            <span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
            <div class="logo"><img src="${iconUrl}" alt="" draggable="false"></div>
            <div class="tick-badge">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path class="tick" d="M5.5 12.8l4.3 4.2L18.6 8"/></svg>
            </div>
          </div>

          <div class="content">
            <div class="badge rise" style="--d:620ms"><span class="dot"></span>${t('welcome.badge')}</div>
            <h1 id="title" class="rise" style="--d:700ms">${t('welcome.title')}</h1>
            <p id="sub" class="sub rise" style="--d:780ms">${t('welcome.subtitle')}</p>
            <p class="body rise" style="--d:860ms">${t('welcome.body')}</p>

            <ul class="grid">
              ${features
                .map(
                  (f, i) => `
                <li class="tile rise" style="--d:${960 + i * 90}ms; --hue:${f.hue}">
                  <span class="ico">${UiKit.icons[f.icon]}</span>
                  <span class="txt"><b>${t(`welcome.${f.k}.title`)}</b><small>${t(`welcome.${f.k}.desc`)}</small></span>
                </li>`
                )
                .join('')}
            </ul>

            <button class="cta rise" type="button" style="--d:1380ms">
              <span class="cta-label">${t('welcome.cta')}</span>
              <span class="cta-arrow">${UiKit.icons.arrow}</span>
            </button>
            <p class="privacy rise" style="--d:1480ms">${UiKit.icons.lock}<span>${t('welcome.privacy')}</span></p>
          </div>
        </section>
      </div>`;

    host.style.pointerEvents = 'auto';
    document.documentElement.appendChild(host);

    const card = root.querySelector('.card');
    const cta = root.querySelector('.cta');
    const closeBtn = root.querySelector('.x');
    const previouslyFocused = document.activeElement;

    // Celebration lands exactly when the check finishes drawing.
    const confettiTimer = setTimeout(() => {
      const r = root.querySelector('.logo').getBoundingClientRect();
      UiKit.confetti(root, { x: r.left + r.width / 2, y: r.top + r.height / 2, count: 110, spread: 1.7, power: 1.15 });
    }, 1050);

    const close = () => {
      if (!this._open) return;
      this._open = false;
      clearTimeout(confettiTimer);
      document.removeEventListener('keydown', onKey, true);
      host.classList.add('closing');
      root.querySelector('.scrim').classList.add('out');
      card.classList.add('out');
      setTimeout(() => {
        host.remove();
        try { previouslyFocused?.focus?.({ preventScroll: true }); } catch (e) { /* page may have changed */ }
      }, 320);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        // Two focusable things: keep focus inside the dialog.
        e.preventDefault();
        card.classList.add('kbd');
        const active = root.activeElement;
        (active === cta ? closeBtn : cta).focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (root.activeElement !== closeBtn) {
          e.preventDefault();
          close();
        }
      } else {
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);

    cta.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    root.querySelector('.scrim').addEventListener('click', close);

    // Focus after the entrance so the focus ring doesn't flash mid-animation.
    setTimeout(() => cta.focus({ preventScroll: true }), 900);
  },

  _css() {
    return `
    .scrim {
      position: fixed; inset: 0; background: var(--scrim);
      -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%);
      animation: scrimIn 420ms var(--ease) both;
    }
    .scrim.out { animation: scrimOut 300ms ease forwards; }
    .stage {
      position: fixed; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-items: safe center; justify-items: center; padding: 16px; overflow-y: auto;
    }
    .card {
      position: relative; width: 100%; max-width: 460px; border-radius: 28px; overflow: hidden;
      background: var(--surface); color: var(--text); box-shadow: var(--shadow-card);
      border: 1px solid var(--border);
      animation: cardIn 780ms 90ms var(--spring) both;
    }
    .card.out { animation: cardOut 300ms cubic-bezier(.4,0,1,1) forwards; }

    /* hero ---------------------------------------------------------- */
    .hero { position: relative; height: 150px; overflow: hidden;
      background: linear-gradient(135deg, #2543d6 0%, #3964fe 46%, #6c5ce7 100%); }
    .aurora { position: absolute; inset: -20%; filter: blur(30px); opacity: .85; }
    .blob { position: absolute; border-radius: 50%; }
    .b1 { width: 55%; height: 90%; left: -5%; top: 10%; background: #7f9bff; animation: drift1 14s ease-in-out infinite alternate; }
    .b2 { width: 50%; height: 80%; right: -5%; top: -10%; background: #a78bfa; animation: drift2 17s ease-in-out infinite alternate; }
    .b3 { width: 40%; height: 60%; left: 35%; bottom: -25%; background: #22d3ee; opacity: .55; animation: drift3 19s ease-in-out infinite alternate; }
    .sheen { position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,0) 55%),
                  radial-gradient(60% 80% at 50% 120%, rgba(255,255,255,.22), transparent 70%); }

    .x { position: absolute; top: 14px; right: 14px; z-index: 6; width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center; color: #fff; background: rgba(255,255,255,.18);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      transition: background 160ms ease, transform 200ms var(--spring);
      animation: fadeIn 400ms 900ms both; }
    .x:hover { background: rgba(255,255,255,.3); transform: rotate(90deg); }
    .x:active { transform: rotate(90deg) scale(.92); }

    /* logo mark (straddles hero + content) -------------------------- */
    .mark { position: absolute; top: 150px; left: 50%; width: 0; height: 0; z-index: 1; pointer-events: none; }
    .content { position: relative; z-index: 2; }
    .ring { position: absolute; left: -48px; top: -48px; width: 96px; height: 96px; border-radius: 50%;
      border: 2px solid rgba(var(--accent-rgb), .45); opacity: 0;
      animation: ripple 2200ms cubic-bezier(.2,.6,.3,1) 2 both; }
    .r1 { animation-delay: 560ms; } .r2 { animation-delay: 1000ms; } .r3 { animation-delay: 1440ms; }
    .logo { position: absolute; left: -44px; top: -44px; width: 88px; height: 88px; border-radius: 26px;
      background: var(--surface); padding: 6px;
      box-shadow: 0 0 0 5px var(--surface), 0 16px 32px -8px rgba(var(--accent-rgb), .55), 0 4px 10px rgba(10,16,60,.18);
      animation: logoIn 760ms 260ms var(--spring) both; }
    .logo img { width: 100%; height: 100%; border-radius: 20px; display: block; object-fit: cover; user-select: none; }
    .tick-badge { position: absolute; left: 22px; top: 22px; width: 30px; height: 30px; border-radius: 50%;
      display: grid; place-items: center; background: linear-gradient(135deg, #34d669, #16a34a);
      box-shadow: 0 0 0 4px var(--surface), 0 6px 14px rgba(22,163,74,.45);
      animation: badgePop 520ms 880ms var(--spring) both; }
    .tick { stroke-dasharray: 22; stroke-dashoffset: 22; animation: draw 420ms 1080ms cubic-bezier(.65,0,.35,1) forwards; }

    /* content ------------------------------------------------------- */
    .content { padding: 68px 30px 26px; text-align: center; }
    .rise { opacity: 0; transform: translateY(12px); animation: rise 620ms var(--d, 0ms) var(--ease) forwards; }

    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; letter-spacing: .01em; color: #16a34a;
      background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.25); }
    :host([data-theme="dark"]) .badge { color: #4ade80; background: rgba(34,197,94,.14); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 0 currentColor; animation: pulse 2s 1.6s ease-out 2; }

    h1 { margin: 14px 0 6px; font-size: 30px; line-height: 1.12; font-weight: 750; letter-spacing: -0.025em;
      background: linear-gradient(135deg, var(--text) 30%, var(--accent) 120%); -webkit-background-clip: text; background-clip: text; color: transparent; }
    :host([data-theme="dark"]) h1 { background: linear-gradient(135deg, #fff 35%, #9db4ff 120%); -webkit-background-clip: text; background-clip: text; }
    .sub { margin: 0 auto; max-width: 340px; font-size: 15.5px; line-height: 1.45; font-weight: 500; color: var(--text); opacity: .92; }
    .body { margin: 10px auto 0; max-width: 360px; font-size: 13.5px; line-height: 1.5; color: var(--text-2); }

    .grid { list-style: none; margin: 20px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: left; }
    .tile { display: flex; gap: 11px; align-items: flex-start; padding: 12px; border-radius: 16px;
      background: var(--surface-2); border: 1px solid var(--border);
      transition: transform 220ms var(--ease), border-color 200ms ease, box-shadow 220ms ease; }
    .tile:hover { transform: translateY(-2px); border-color: rgba(var(--hue), .45); box-shadow: 0 10px 24px -12px rgba(var(--hue), .5); }
    .ico { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
      color: rgb(var(--hue)); background: rgba(var(--hue), .14); transition: transform 260ms var(--spring); }
    .tile:hover .ico { transform: scale(1.08) rotate(-4deg); }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt b { font-size: 13.5px; font-weight: 650; color: var(--text); letter-spacing: -.005em; }
    .txt small { font-size: 12px; line-height: 1.38; color: var(--text-2); }

    .cta { position: relative; overflow: hidden; width: 100%; height: 54px; margin-top: 22px; border-radius: 16px;
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      font-size: 16px; font-weight: 650; letter-spacing: -.005em; color: #fff; background: var(--grad);
      box-shadow: 0 12px 26px -8px rgba(var(--accent-rgb), .65), 0 1px 0 rgba(255,255,255,.35) inset;
      transition: transform 200ms var(--spring), box-shadow 240ms ease, filter 200ms ease; }
    .cta::after { content: ""; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent);
      transform: skewX(-18deg) translateX(-120%); animation: shimmer 1100ms 1900ms ease-out 1 both; }
    .cta:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 16px 32px -8px rgba(var(--accent-rgb), .75), 0 1px 0 rgba(255,255,255,.35) inset; }
    .cta:active { transform: scale(.985); }
    .cta-arrow { display: grid; transition: transform 240ms var(--spring); }
    .cta:hover .cta-arrow { transform: translateX(4px); }
    .card button:focus-visible { outline: none; }
    .card.kbd .cta:focus-visible { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--accent), 0 12px 26px -8px rgba(var(--accent-rgb), .65); }
    .card.kbd .x:focus-visible { box-shadow: 0 0 0 2px #fff; }

    .privacy { margin: 14px 0 0; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--text-3); }

    @media (max-width: 440px) {
      .hero { height: 112px; }
      .mark { top: 112px; }
      .content { padding: 64px 18px 20px; }
      .grid { grid-template-columns: 1fr; gap: 8px; margin-top: 16px; }
      .tile { padding: 10px 12px; align-items: center; }
      .cta { margin-top: 18px; height: 52px; }
      h1 { font-size: 26px; }
    }
    @media (max-height: 640px) { .hero { height: 110px; } .mark { top: 110px; } .content { padding-top: 62px; } }

    @keyframes scrimIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes scrimOut { to { opacity: 0; } }
    @keyframes cardIn { from { opacity: 0; transform: translateY(34px) scale(.94); } to { opacity: 1; transform: none; } }
    @keyframes cardOut { to { opacity: 0; transform: translateY(14px) scale(.97); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes rise { to { opacity: 1; transform: none; } }
    @keyframes logoIn { from { opacity: 0; transform: scale(.55) rotate(-8deg); } to { opacity: 1; transform: none; } }
    @keyframes badgePop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes ripple { 0% { opacity: 0; transform: scale(.9); } 12% { opacity: .9; } 100% { opacity: 0; transform: scale(2.5); } }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 100% { box-shadow: 0 0 0 9px rgba(34,197,94,0); } }
    @keyframes shimmer { to { transform: skewX(-18deg) translateX(520%); } }
    @keyframes drift1 { to { transform: translate(18%, -12%) scale(1.15); } }
    @keyframes drift2 { to { transform: translate(-16%, 14%) scale(1.1); } }
    @keyframes drift3 { to { transform: translate(-22%, -10%) scale(1.25); } }
    `;
  },
};
