// ui-kit.js - shared building blocks for DeepBlue's two "moment" surfaces:
// the one-time welcome splash (welcome.js) and the review prompt
// (review-prompt.js).
//
// Both render inside a closed-off Shadow DOM so DeepSeek's own CSS can never
// leak in (and ours can never leak out), and both share one design language:
// the same tokens, easing curves, and celebration (confetti) so they feel
// like one product.
//
// Depends on: theme.js (Theme._detectDark), utils.js (escapeHtml).

'use strict';

const UiKit = {
  reducedMotion() {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  },

  // Creates a fixed, full-viewport host element with an open shadow root.
  // The host itself ignores pointer events; each surface opts its own
  // interactive pieces back in, so the page underneath stays usable where
  // it should be (review card) and blocked where it should be (splash).
  createHost(id) {
    document.getElementById(id)?.remove();
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText =
      'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    host.setAttribute('data-theme', Theme._detectDark() ? 'dark' : 'light');
    const root = host.attachShadow({ mode: 'open' });
    return { host, root };
  },

  // Tokens shared by every surface. Light/dark follows DeepSeek's own mode.
  baseCss: `
    :host {
      --accent: #3964fe;
      --accent-2: #6c5ce7;
      --accent-rgb: 57, 100, 254;
      --grad: linear-gradient(135deg, #4f74ff 0%, #3964fe 52%, #6c5ce7 100%);
      --success: #22c55e;
      --gold-1: #ffc83d;
      --gold-2: #ff9f1a;

      --surface: #ffffff;
      --surface-2: #f5f6fa;
      --surface-3: #eceef5;
      --text: #14161c;
      --text-2: #565a67;
      --text-3: #858996;
      --border: rgba(20, 22, 30, 0.08);
      --border-strong: rgba(20, 22, 30, 0.14);
      --scrim: radial-gradient(120% 120% at 50% 0%, rgba(30, 44, 120, 0.50), rgba(8, 10, 24, 0.70));
      --shadow-card: 0 1px 0 rgba(255,255,255,.6) inset, 0 30px 80px -12px rgba(10, 16, 60, 0.45), 0 12px 28px -8px rgba(10, 16, 60, 0.25);
      --shadow-toast: 0 24px 60px -12px rgba(10, 16, 60, 0.32), 0 8px 20px -6px rgba(10, 16, 60, 0.18);

      --ease: cubic-bezier(0.16, 1, 0.3, 1);
      --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;

      color-scheme: light;
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    :host([data-theme="dark"]) {
      --surface: #1b1c21;
      --surface-2: #25262c;
      --surface-3: #2f3037;
      --text: #f5f6f9;
      --text-2: #b4b7c2;
      --text-3: #7f838f;
      --border: rgba(255, 255, 255, 0.09);
      --border-strong: rgba(255, 255, 255, 0.16);
      --scrim: radial-gradient(120% 120% at 50% 0%, rgba(40, 58, 160, 0.42), rgba(2, 3, 10, 0.78));
      --shadow-card: 0 1px 0 rgba(255,255,255,.07) inset, 0 30px 80px -12px rgba(0, 0, 0, 0.7), 0 12px 28px -8px rgba(0, 0, 0, 0.5);
      --shadow-toast: 0 24px 60px -12px rgba(0, 0, 0, 0.65), 0 8px 20px -6px rgba(0, 0, 0, 0.45);
      color-scheme: dark;
    }
    *, *::before, *::after { box-sizing: border-box; }
    :host, button, input { font-family: var(--font); }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; -webkit-tap-highlight-color: transparent; }
    button:focus { outline: none; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        transition-delay: 0ms !important;
      }
    }
  `,

  icons: {
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.6-3.6"/></svg>',
    folder: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.1a2 2 0 0 0 1.5.7h5.4a2 2 0 0 1 2 2V17.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
    bookmark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V4.5a1 1 0 0 1 1-1z"/></svg>',
    export: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
    arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    external: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    heart: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.6 2.7 5 6.2 5c2 0 3.3 1 3.8 2.1h.0C10.5 6 11.8 5 13.8 5c3.5 0 5.3 3.6 3.8 6.8C19.5 16.4 12 21 12 21z" transform="translate(0 -.5)"/></svg>',
  },

  // One celebratory burst of brand-colored confetti, launched from (x, y)
  // in viewport coordinates. Self-cleaning. Skipped entirely when the
  // person asked their OS for reduced motion.
  confetti(root, { x, y, count = 90, spread = 1.5, power = 1 } = {}) {
    if (this.reducedMotion()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    root.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const colors = ['#3964fe', '#6c5ce7', '#7f9bff', '#22c55e', '#ffc83d', '#ff7a59', '#ec4899', '#14b8a6'];
    const parts = Array.from({ length: count }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread * Math.PI;
      const speed = (6 + Math.random() * 10) * power;
      return {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[(Math.random() * colors.length) | 0],
        round: Math.random() < 0.3,
        wob: Math.random() * Math.PI * 2,
      };
    });

    const DURATION = 2600;
    const start = performance.now();
    const tick = (now) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade = t > DURATION * 0.6 ? 1 - (t - DURATION * 0.6) / (DURATION * 0.4) : 1;
      for (const p of parts) {
        p.vy += 0.3;
        p.vx *= 0.99;
        p.vy *= 0.992;
        p.x += p.vx + Math.sin(p.wob + t / 180) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (t < DURATION) requestAnimationFrame(tick);
      else canvas.remove();
    };
    requestAnimationFrame(tick);
  },

  // Chrome's extension APIs throw if the extension was reloaded/updated
  // while an old content script is still alive; every call site routes
  // through here so that never surfaces as an error.
  storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (res) => resolve(chrome.runtime.lastError ? undefined : res?.[key]));
      } catch (err) {
        resolve(undefined);
      }
    });
  },

  storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve(!chrome.runtime.lastError));
      } catch (err) {
        resolve(false);
      }
    });
  },
};
