// whats-new.js - one-time "subfolders are here" card for EXISTING users.
//
// Who sees it: only people who already had DeepBlue installed and just
// updated to 1.3. background.js raises a "pending" flag on that update (and
// never on a fresh install, where the welcome splash already introduces
// folders), and exactly one DeepSeek tab claims it, so it is shown once.
//
// It's a quiet card in the bottom-left corner, near the sidebar it talks
// about. It does not block the page, and stays until dismissed.
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

    const folderSvg = (hex) => `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 7C3 5.9 3.9 5 5 5H9L11 7H19C20.1 7 21 7.9 21 9V17C21 18.1 20.1 19 19 19H5C3.9 19 3 18.1 3 17V7Z"
          fill="${hex}" fill-opacity="0.28" stroke="${hex}" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>`;
    const plus = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
    const chevron = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    const blue = '#3964fe';
    root.innerHTML = `
      <style>${UiKit.baseCss}${this._css()}</style>
      <div class="dock">
        <section class="card" role="status" aria-live="polite" aria-labelledby="wn-title">
          <button class="x" type="button" aria-label="${t('review.close')}">${UiKit.icons.close}</button>

          <div class="badge"><span class="dot"></span>${t('whatsnew.badge')}</div>
          <h2 id="wn-title">${t('whatsnew.title')}</h2>
          <p class="body">${t('whatsnew.body')}</p>

          <div class="demo" aria-hidden="true">
            <div class="row r0" style="--d:260ms">
              <span class="chev open">${chevron}</span>${folderSvg(blue)}<b>${t('whatsnew.demo1')}</b>
              <span class="add">${plus}</span>
            </div>
            <div class="nest n1">
              <div class="row r1" style="--d:520ms">
                <span class="chev open">${chevron}</span>${folderSvg('#6c5ce7')}<b>${t('whatsnew.demo2')}</b>
              </div>
              <div class="nest n2">
                <div class="row r2" style="--d:780ms">
                  <span class="chev">${chevron}</span>${folderSvg('#22c55e')}<b>${t('whatsnew.demo3')}</b>
                </div>
              </div>
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

    .demo { margin: 14px 0 0; padding: 10px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
    .row { display: flex; align-items: center; gap: 7px; padding: 5px 6px; border-radius: 8px; font-size: 12.5px;
      opacity: 0; transform: translateX(-8px); animation: slideIn 520ms var(--d, 0ms) var(--ease) forwards; }
    .row b { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row svg { flex: none; }
    .chev { display: grid; color: var(--text-3); transition: transform 200ms ease; }
    .chev.open { transform: rotate(90deg); }
    .nest { margin-left: 11px; padding-left: 9px; border-left: 2px solid rgba(var(--accent-rgb), .45); }
    .nest.n2 { border-left-color: rgba(108, 92, 231, .5); }
    .r1 { background: rgba(108, 92, 231, .10); }
    .r2 { background: rgba(34, 197, 94, .10); }
    .add { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; flex: none;
      color: var(--accent); background: rgba(var(--accent-rgb), .14); animation: nudge 2.4s 1.4s ease-in-out infinite; }

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
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), .5); } 100% { box-shadow: 0 0 0 8px rgba(var(--accent-rgb), 0); } }
    @keyframes nudge { 0%, 70%, 100% { transform: scale(1); } 80% { transform: scale(1.22); } 90% { transform: scale(1); } }
    `;
  },
};
