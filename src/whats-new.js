// whats-new.js - one-time full-screen announcement of VamimiAI and the
// Diagram button (features/diagram-handoff.js) for EXISTING users.
//
// Who sees it, once (background.js claimAnnouncement): people updating from
// before 1.6 on their next DeepSeek visit, and new installs only after
// DeepSeek has been opened on 3 different days - never in a new user's first
// days. Exactly one DeepSeek tab claims it. Showing it arms the Diagram
// button's spotlight (DiagramHandoff.armSpotlight), which also waits for it.
//
// What it has to answer, in this order: what VamimiAI is (a website that
// turns text into diagrams), what that looks like (the hero picture: reply
// lines become a small flowchart, drawn once), and what to do (three steps,
// with a copy of the real button). The main action, "Show me the button",
// closes the dialog and hands over to DiagramHandoff.spotlightNow(), which
// scrolls to the newest Diagram button and makes it glow - or, in a chat
// with no reply yet, says to ask something first. "Or visit vamimi.com"
// opens the site in a new tab (its own utm campaign). Every animation runs
// once and ends still; reduced motion shows the final state at once.
//
// Depends on: ui-kit.js, i18n.js (Lang), theme.js (Theme), utils.js
// (escapeHtml), features/diagram-handoff.js (DiagramHandoff - only on click,
// long after every module has loaded).

'use strict';

const WhatsNew = {
  _HOST_ID: 'deepblue-whatsnew-host',
  _open: false,

  async maybeShow() {
    if (document.visibilityState !== 'visible') {
      document.addEventListener(
        'visibilitychange',
        () => document.visibilityState === 'visible' && this.maybeShow(),
        { once: true }
      );
      return;
    }

    let claimed = false;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'deepblue:claim-whatsnew' });
      claimed = !!res?.claimed;
    } catch (err) {
      return;
    }
    if (!claimed) return;

    // Let DeepSeek paint first so the dialog arrives over a settled page.
    setTimeout(() => this.show(), 900);
  },

  show() {
    if (this._open) return;
    this._open = true;
    Theme.sync();
    Lang.sync();

    const t = (k) => escapeHtml(Lang.t(k));
    const { host, root } = UiKit.createHost(this._HOST_ID);
    const pill = `<span class="pill">${DiagramHandoff._icon()}<span>${t('diagram.label')}</span></span>`;

    root.innerHTML = `
      <style>${UiKit.baseCss}${this._css()}</style>
      <div class="scrim"></div>
      <div class="stage">
        <section class="card" role="dialog" aria-modal="true" aria-labelledby="wn-title" aria-describedby="wn-sub">
          <div class="hero" aria-hidden="true">
            <div class="sheen"></div>
            <div class="demo">
              <div class="reply">
                <i style="--d:300ms;--w:88%"></i><i style="--d:380ms;--w:70%"></i>
                <i style="--d:460ms;--w:80%"></i><i style="--d:540ms;--w:56%"></i>
                <small>${t('whatsnew.demo1')}</small>
              </div>
              <svg class="arrow" viewBox="0 0 40 16" width="40" height="16"><path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div class="flow">
                <b class="node" style="--d:900ms">${t('whatsnew.demo2')} 1</b>
                <span class="link" style="--d:1080ms"></span>
                <b class="node" style="--d:1180ms">${t('whatsnew.demo2')} 2</b>
                <span class="link" style="--d:1360ms"></span>
                <b class="node ok" style="--d:1460ms">${t('whatsnew.demo3')}</b>
              </div>
            </div>
          </div>
          <button class="x" type="button" aria-label="${t('review.close')}">${UiKit.icons.close}</button>

          <div class="content">
            <div class="badge rise" style="--d:200ms"><span class="dot"></span>${t('whatsnew.badge')}</div>
            <h1 id="wn-title" class="rise" style="--d:280ms">${t('whatsnew.title')}</h1>
            <p id="wn-sub" class="sub rise" style="--d:360ms">${t('whatsnew.sub')}</p>
            <p class="body rise" style="--d:440ms">${t('whatsnew.body')}</p>

            <ol class="steps">
              <li class="rise" style="--d:600ms"><span class="n">1</span><span>${t('whatsnew.step1')}</span></li>
              <li class="rise" style="--d:690ms"><span class="n">2</span><span>${t('whatsnew.step2').replace('{label}', pill)}</span></li>
              <li class="rise" style="--d:780ms"><span class="n">3</span><span>${t('whatsnew.step3')}</span></li>
            </ol>

            <button class="cta rise" type="button" style="--d:920ms">
              <span>${t('whatsnew.cta')}</span><span class="cta-arrow">${UiKit.icons.arrow}</span>
            </button>
            <button class="visit rise" type="button" style="--d:1000ms">${t('whatsnew.visit')} ↗</button>
            <p class="privacy rise" style="--d:1060ms">${UiKit.icons.lock}<span>${t('whatsnew.privacy')}</span></p>
          </div>
        </section>
      </div>`;

    host.style.pointerEvents = 'auto';
    document.documentElement.appendChild(host);
    DiagramHandoff.armSpotlight();

    const card = root.querySelector('.card');
    const cta = root.querySelector('.cta');
    const visit = root.querySelector('.visit');
    const closeBtn = root.querySelector('.x');
    const focusables = [cta, visit, closeBtn];
    const previouslyFocused = document.activeElement;

    const close = (then) => {
      if (!this._open) return;
      this._open = false;
      document.removeEventListener('keydown', onKey, true);
      root.querySelector('.scrim').classList.add('out');
      card.classList.add('out');
      setTimeout(() => {
        host.remove();
        try { previouslyFocused?.focus?.({ preventScroll: true }); } catch (e) { /* page may have changed */ }
        if (typeof then === 'function') then();
      }, 320);
    };
    const showMe = () => close(() => DiagramHandoff.spotlightNow());
    const goVisit = () => {
      DiagramHandoff.openTab(DiagramHandoff.appUrl('announcement')).catch(() => {});
      close();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        card.classList.add('kbd');
        const i = focusables.indexOf(root.activeElement);
        focusables[(i + (e.shiftKey ? focusables.length - 1 : 1)) % focusables.length].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const active = root.activeElement;
        if (active === visit) goVisit();
        else if (active === closeBtn) close();
        else showMe();
      } else {
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);

    cta.addEventListener('click', showMe);
    visit.addEventListener('click', goVisit);
    closeBtn.addEventListener('click', () => close());
    root.querySelector('.scrim').addEventListener('click', () => close());

    setTimeout(() => cta.focus({ preventScroll: true }), 900);
  },

  _css() {
    return `
    .scrim { position: fixed; inset: 0; background: var(--scrim);
      -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%);
      animation: scrimIn 420ms var(--ease) both; }
    .scrim.out { animation: scrimOut 300ms ease forwards; }
    .stage { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-items: safe center;
      justify-items: center; padding: 16px; overflow-y: auto; }
    .card { position: relative; width: 100%; max-width: 480px; border-radius: 28px; overflow: hidden;
      background: var(--surface); color: var(--text); box-shadow: var(--shadow-card); border: 1px solid var(--border);
      animation: cardIn 780ms 90ms var(--spring) both; }
    .card.out { animation: cardOut 300ms cubic-bezier(.4,0,1,1) forwards; }

    /* hero: reply lines become a flowchart ---------------------------- */
    .hero { position: relative; height: 196px; overflow: hidden; display: grid; place-items: center;
      background: linear-gradient(135deg, #2543d6 0%, #3964fe 46%, #6c5ce7 100%); }
    .sheen { position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,0) 55%),
                  radial-gradient(60% 80% at 50% 120%, rgba(255,255,255,.22), transparent 70%); }
    .demo { position: relative; display: flex; align-items: center; gap: 18px; }
    .reply { width: 150px; padding: 14px 14px 10px; border-radius: 14px; background: rgba(255,255,255,.96);
      box-shadow: 0 14px 30px -12px rgba(10,16,60,.5); display: grid; gap: 7px;
      animation: pop 520ms 160ms var(--spring) both; }
    .reply i { display: block; height: 7px; width: var(--w); border-radius: 4px; background: #d9def0;
      transform-origin: left; transform: scaleX(0); animation: grow 380ms var(--d) var(--ease) forwards; }
    .reply small { font-size: 11px; font-weight: 600; color: #6c6c72; margin-top: 3px; }
    .arrow { opacity: 0; animation: slideIn 420ms 700ms var(--ease) forwards; }
    .flow { display: flex; flex-direction: column; align-items: center; }
    .node { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 700; white-space: nowrap;
      color: #2543d6; background: #fff; box-shadow: 0 8px 18px -8px rgba(10,16,60,.55);
      opacity: 0; transform: scale(.6); animation: pop 460ms var(--d) var(--spring) forwards; }
    .node.ok { color: #fff; background: #22c55e; }
    .link { width: 2px; height: 12px; background: rgba(255,255,255,.85); transform: scaleY(0); transform-origin: top;
      animation: growY 200ms var(--d) ease-out forwards; }

    .x { position: absolute; top: 14px; right: 14px; z-index: 6; width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center; color: #fff; background: rgba(255,255,255,.18);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      transition: background 160ms ease, transform 200ms var(--spring); }
    .x:hover { background: rgba(255,255,255,.3); transform: rotate(90deg); }

    /* content -------------------------------------------------------- */
    .content { padding: 24px 30px 24px; text-align: center; }
    .rise { opacity: 0; transform: translateY(12px); animation: rise 620ms var(--d, 0ms) var(--ease) forwards; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 650; color: var(--accent);
      background: rgba(var(--accent-rgb), .1); border: 1px solid rgba(var(--accent-rgb), .22); }
    :host([data-theme="dark"]) .badge { color: #9db4ff; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    h1 { margin: 12px 0 6px; font-size: 30px; line-height: 1.12; font-weight: 750; letter-spacing: -0.025em;
      background: linear-gradient(135deg, var(--text) 30%, var(--accent) 120%); -webkit-background-clip: text; background-clip: text; color: transparent; }
    :host([data-theme="dark"]) h1 { background: linear-gradient(135deg, #fff 35%, #9db4ff 120%); -webkit-background-clip: text; background-clip: text; }
    .sub { margin: 0 auto; max-width: 360px; font-size: 16px; line-height: 1.4; font-weight: 600; color: var(--text); }
    .body { margin: 8px auto 0; max-width: 380px; font-size: 13.5px; line-height: 1.5; color: var(--text-2); }

    .steps { list-style: none; margin: 20px 0 0; padding: 14px; border-radius: 18px; display: grid; gap: 12px; text-align: left;
      background: var(--surface-2); border: 1px solid var(--border); }
    .steps li { display: flex; align-items: center; gap: 12px; font-size: 14px; line-height: 1.45; color: var(--text); }
    .n { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
      font-size: 13px; font-weight: 750; color: #fff; background: var(--grad); }
    .pill { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 8px; margin: 0 2px;
      border-radius: 999px; vertical-align: middle; font-size: 12.5px; font-weight: 650; color: #fff; background: var(--grad);
      box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .16); animation: glow 1.6s 1.4s ease-out 2; }

    .cta { position: relative; overflow: hidden; width: 100%; height: 54px; margin-top: 20px; border-radius: 16px;
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      font-size: 16px; font-weight: 650; color: #fff; background: var(--grad);
      box-shadow: 0 12px 26px -8px rgba(var(--accent-rgb), .65), 0 1px 0 rgba(255,255,255,.35) inset;
      transition: transform 200ms var(--spring), filter 200ms ease; }
    .cta:hover { transform: translateY(-1px); filter: brightness(1.06); }
    .cta:active { transform: scale(.985); }
    .cta-arrow { display: grid; transition: transform 240ms var(--spring); }
    .cta:hover .cta-arrow { transform: translateX(4px); }
    .visit { margin-top: 12px; padding: 6px 10px; border-radius: 10px; font-size: 14px; font-weight: 600; color: var(--accent);
      transition: background 160ms ease; }
    :host([data-theme="dark"]) .visit { color: #9db4ff; }
    .visit:hover { background: rgba(var(--accent-rgb), .08); }
    .card button:focus-visible { outline: none; }
    .card.kbd .cta:focus-visible { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--accent); }
    .card.kbd .visit:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
    .card.kbd .x:focus-visible { box-shadow: 0 0 0 2px #fff; }
    .privacy { margin: 8px 0 0; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--text-3); }

    @media (max-width: 440px) {
      .hero { height: 168px; } .demo { gap: 10px; transform: scale(.88); }
      .content { padding: 20px 18px 20px; } h1 { font-size: 26px; }
    }
    @media (max-height: 700px) { .hero { height: 150px; } .demo { transform: scale(.82); } .steps { margin-top: 14px; } }

    @keyframes scrimIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes scrimOut { to { opacity: 0; } }
    @keyframes cardIn { from { opacity: 0; transform: translateY(34px) scale(.94); } to { opacity: 1; transform: none; } }
    @keyframes cardOut { to { opacity: 0; transform: translateY(14px) scale(.97); } }
    @keyframes rise { to { opacity: 1; transform: none; } }
    @keyframes pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
    @keyframes grow { to { transform: scaleX(1); } }
    @keyframes growY { to { transform: scaleY(1); } }
    @keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
    @keyframes glow { 0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), .55); } 70% { box-shadow: 0 0 0 10px rgba(var(--accent-rgb), 0); }
      100% { box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .16); } }
    `;
  },
};
