// whats-new.js - one-time "turn any reply into a diagram" card for
// EXISTING users (features/diagram-handoff.js).
//
// Who sees it: only people who already had DeepBlue installed and just
// updated to 1.5. background.js raises a "pending" flag on that update (and
// never on a fresh install), and exactly one DeepSeek tab claims it, so it
// is shown once.
//
// It's a quiet card in the bottom-left corner. It does not block the page,
// and stays until dismissed. Its small picture - reply lines turning into a
// three-step diagram - plays once and ends still.
//
// Depends on: ui-kit.js, i18n.js (Lang), theme.js (Theme), utils.js (escapeHtml).

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

    // Let DeepSeek (and the sidebar) settle first.
    setTimeout(() => this.show(), 1800);
  },

  show() {
    if (this._open) return;
    this._open = true;
    Theme.sync();
    Lang.sync();

    const t = (k) => escapeHtml(Lang.t(k));
    const { host, root } = UiKit.createHost(this._HOST_ID);

    root.innerHTML = `
      <style>${UiKit.baseCss}${this._css()}</style>
      <div class="dock">
        <section class="card" role="status" aria-live="polite" aria-labelledby="wn-title">
          <button class="x" type="button" aria-label="${t('review.close')}">${UiKit.icons.close}</button>

          <div class="badge"><span class="dot"></span>${t('whatsnew.badge')}</div>
          <h2 id="wn-title">${t('whatsnew.title')}</h2>
          <p class="body">${t('whatsnew.body')}</p>

          <div class="demo" aria-hidden="true">
            <div class="reply">
              <i style="--d:200ms;--w:92%"></i><i style="--d:280ms;--w:74%"></i><i style="--d:360ms;--w:84%"></i>
              <small>${t('whatsnew.demo1')}</small>
            </div>
            <span class="arrow" style="--d:560ms">→</span>
            <div class="flow">
              <b class="node" style="--d:760ms">${t('whatsnew.demo2')} 1</b>
              <span class="link" style="--d:940ms"></span>
              <b class="node" style="--d:1040ms">${t('whatsnew.demo2')} 2</b>
              <span class="link" style="--d:1220ms"></span>
              <b class="node ok" style="--d:1320ms">${t('whatsnew.demo3')}</b>
            </div>
          </div>

          <p class="hint">${t('whatsnew.hint')}</p>
          <button class="cta" type="button"><span>${t('whatsnew.cta')}</span></button>
        </section>
      </div>`;

    host.style.pointerEvents = 'none';
    document.documentElement.appendChild(host);

    const card = root.querySelector('.card');
    const close = () => {
      if (!this._open) return;
      this._open = false;
      card.classList.add('out');
      setTimeout(() => host.remove(), 300);
    };
    root.querySelector('.cta').addEventListener('click', close);
    root.querySelector('.x').addEventListener('click', close);
  },

  _css() {
    return `
    .dock { position: fixed; left: 20px; bottom: 20px; width: 332px; max-width: calc(100vw - 24px); pointer-events: none; }
    .card { position: relative; pointer-events: auto; padding: 18px 18px 16px; border-radius: 22px;
      background: var(--surface); color: var(--text); border: 1px solid var(--border);
      box-shadow: var(--shadow-toast); animation: cardIn 640ms var(--spring) both; }
    .card.out { animation: cardOut 280ms cubic-bezier(.4,0,1,1) forwards; }

    .x { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center; color: var(--text-3); transition: background 160ms ease, color 160ms ease; }
    .x:hover { background: var(--surface-2); color: var(--text); }

    .badge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px 4px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
      color: var(--accent); background: rgba(var(--accent-rgb), .12); border: 1px solid rgba(var(--accent-rgb), .22); }
    :host([data-theme="dark"]) .badge { color: #9db4ff; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 2s 1s ease-out 2; }

    h2 { margin: 10px 0 4px; font-size: 18px; line-height: 1.2; font-weight: 750; letter-spacing: -.015em; padding-right: 24px; }
    .body { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }

    .demo { margin: 14px 0 0; padding: 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border);
      display: flex; align-items: center; gap: 10px; }
    .reply { flex: 1; min-width: 0; display: grid; gap: 6px; }
    .reply i { display: block; height: 7px; width: var(--w); border-radius: 4px; background: var(--border);
      opacity: 0; animation: fadeIn 360ms var(--d, 0ms) var(--ease) forwards; }
    .reply small { font-size: 11px; color: var(--text-3); margin-top: 2px; }
    .arrow { color: var(--accent); font-weight: 700; opacity: 0; animation: fadeIn 360ms var(--d) var(--ease) forwards; }
    .flow { flex: none; display: flex; flex-direction: column; align-items: center; }
    .node { padding: 3px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; white-space: nowrap;
      color: var(--accent); background: rgba(var(--accent-rgb), .12); border: 1px solid rgba(var(--accent-rgb), .35);
      opacity: 0; transform: translateY(-4px); animation: slideIn 420ms var(--d) var(--ease) forwards; }
    .node.ok { color: #16a34a; background: rgba(34, 197, 94, .12); border-color: rgba(34, 197, 94, .4); }
    .link { width: 2px; height: 8px; background: rgba(var(--accent-rgb), .45); transform: scaleY(0); transform-origin: top;
      animation: grow 200ms var(--d) ease-out forwards; }

    .hint { margin: 12px 0 0; font-size: 12px; color: var(--text-3); line-height: 1.45; }
    .cta { width: 100%; height: 40px; margin-top: 12px; border-radius: 12px; font-size: 14px; font-weight: 650;
      color: #fff; background: var(--grad); box-shadow: 0 8px 18px -8px rgba(var(--accent-rgb), .7);
      transition: transform 200ms var(--spring), filter 200ms ease; }
    .cta:hover { transform: translateY(-1px); filter: brightness(1.06); }
    .cta:active { transform: scale(.985); }

    @media (max-width: 440px) { .dock { left: 12px; right: 12px; bottom: 12px; width: auto; max-width: none; } }

    @keyframes cardIn { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: none; } }
    @keyframes cardOut { to { opacity: 0; transform: translateY(10px) scale(.98); } }
    @keyframes slideIn { to { opacity: 1; transform: none; } }
    @keyframes fadeIn { to { opacity: 1; } }
    @keyframes grow { to { transform: scaleY(1); } }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), .5); } 100% { box-shadow: 0 0 0 8px rgba(var(--accent-rgb), 0); } }
    `;
  },
};
