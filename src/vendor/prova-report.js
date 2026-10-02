// VENDORED from Prova (prova.lacarm.com/widget/report.js, VERSION below). Do not edit here: change it in
// the Prova repo (server/widget/report.js) and copy it again, so every app runs the same widget.
// Prova "Report a problem" widget (plan 18) — zero dependencies, one ES module, usable by any app.
// Served by Prova at /widget/report.js (and its stylesheet at /widget/report.css); apps VENDOR a copy,
// because the browser never talks to Prova: every call goes to the app's own server (the relay), which
// adds the signed-in user and the installation key and forwards to Prova.
//
//   import { createReporter, createErrorRing } from './report.js';
//   const ring = createErrorRing(); ring.install(window);
//   const reporter = createReporter({
//     reportUrl: '/api/report', mineUrl: '/api/reports/mine', headers: () => ({ 'X-CSRF-Token': token }),
//     user: 'beyza', app: { name: 'Beatrina SE', version: '1.5.18', host: location.host },
//     team: 'the Beatrina developers', page: () => document.title, errors: () => ring.list(),
//     stylesheet: '/report.css',   // only where the page's CSP forbids an inline <style>
//   });
//   reporter.bindMenu({ reportRow, mineRow, avatar });   // rows the app's own user menu already has
//
// Nothing here sets innerHTML: every value is text. Document content is never collected.

export const VERSION = '1.0.0';
export const SCREENSHOT_MAX = 2 * 1024 * 1024;
export const MIN_TEXT = 10;

export const CSS = `
.prova-rp{--pr-font:Figtree,Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--pr-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--pr-panel:#fff;--pr-line:#e6e8e4;--pr-line-soft:#eef0ec;
--pr-control:#8e9691;--pr-text:#1c1f1e;--pr-muted:#5b615d;--pr-faint:#6a706c;--pr-accent:#0b6e6e;--pr-accent-hover:#084f4f;--pr-soft:#e3f1ef;
--pr-soft-text:#0b5c5c;--pr-error:#b42318;--pr-error-bg:#fef3f2;--pr-error-line:#fecdca;--pr-warn-bg:#fffaeb;--pr-warn-line:#fedf89;
--pr-warn-text:#93370d;--pr-blue-bg:#eaf0f8;--pr-blue-text:#2f4f86;--pr-idle-bg:#eff1ee;--pr-idle-text:#4b504d;--pr-foot:#fbfcfb;
--pr-shadow:0 18px 40px rgba(0,30,30,.18);--pr-scrim:rgba(20,30,25,.28)}
.prova-rp.prova-dark{--pr-panel:#1d2221;--pr-line:#343b39;--pr-line-soft:#2a302e;--pr-control:#6b7470;--pr-text:#e8ece9;--pr-muted:#a9b2ae;
--pr-faint:#98a19d;--pr-accent:#3fb5ad;--pr-accent-hover:#5cc9c1;--pr-soft:#173836;--pr-soft-text:#8fe0d9;--pr-error:#ff8a80;--pr-error-bg:#3a1f1d;
--pr-error-line:#6b2b26;--pr-warn-bg:#3a2f12;--pr-warn-line:#6b5420;--pr-warn-text:#f5cf7a;--pr-blue-bg:#1e2a40;--pr-blue-text:#a9c2f0;
--pr-idle-bg:#2a302e;--pr-idle-text:#c4ccc8;--pr-foot:#191d1c;--pr-shadow:0 18px 40px rgba(0,0,0,.5);--pr-scrim:rgba(0,0,0,.45)}
.prova-rp{position:fixed;inset:0;z-index:2147483000;background:var(--pr-scrim);display:flex;justify-content:flex-end;align-items:flex-start;
padding:64px 20px 20px;font:14px/1.45 var(--pr-font);color:var(--pr-text);box-sizing:border-box}
.prova-rp *,.prova-rp *::before,.prova-rp *::after{box-sizing:border-box}
.prova-rp.prova-center{justify-content:center;align-items:center;padding:20px}
.prova-dlg{width:440px;max-width:100%;max-height:calc(100vh - 84px);display:flex;flex-direction:column;background:var(--pr-panel);border-radius:12px;
box-shadow:var(--pr-shadow);overflow:hidden;outline:none}
.prova-dlg header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--pr-line-soft)}
.prova-dlg header h3{margin:0;font-size:15px;font-weight:700;color:var(--pr-text)}
.prova-x{margin-left:auto;border:0;background:none;font:inherit;font-size:18px;line-height:1;color:var(--pr-muted);cursor:pointer;padding:4px 6px;border-radius:6px}
.prova-x:hover{background:var(--pr-line-soft)}
.prova-rows{padding:12px 14px;display:grid;gap:10px;overflow:auto}
.prova-rp label{display:grid;gap:4px;font-size:12px;font-weight:600;color:var(--pr-muted)}
.prova-rp textarea{font:inherit;font-weight:400;color:var(--pr-text);border:1px solid var(--pr-control);border-radius:7px;padding:7px 9px;background:var(--pr-panel);
width:100%;resize:vertical;min-height:62px;margin:0}
.prova-rp textarea.prova-small{min-height:40px}
.prova-rp textarea:focus,.prova-rp button:focus-visible,.prova-rp a:focus-visible,.prova-rp summary:focus-visible{outline:2px solid var(--pr-accent);outline-offset:1px}
.prova-rp textarea:disabled{opacity:.7}
.prova-req::after{content:" *";color:var(--pr-error)}
.prova-drop{border:1px dashed var(--pr-control);border-radius:7px;padding:9px;color:var(--pr-muted);font-size:12px;display:flex;align-items:center;gap:10px}
.prova-drop.prova-over{border-color:var(--pr-accent);background:var(--pr-soft)}
.prova-thumb{width:84px;height:52px;border-radius:5px;border:1px solid var(--pr-line);flex:none;object-fit:cover;background:var(--pr-line-soft)}
.prova-link{border:0;background:none;padding:0;font:inherit;color:var(--pr-accent);text-decoration:underline;cursor:pointer}
.prova-drop .prova-pick{margin-left:auto;text-align:right}
.prova-tech{border:1px solid var(--pr-line);border-radius:8px}
.prova-tech summary{list-style:none;cursor:pointer;padding:7px 10px;font-size:12px;font-weight:600;display:flex;gap:6px;align-items:center;color:var(--pr-text)}
.prova-tech summary::-webkit-details-marker{display:none}
.prova-tech summary::before{content:"\\25B8";color:var(--pr-muted)}.prova-tech[open] summary::before{content:"\\25BE"}
.prova-tech summary span{margin-left:auto;font-weight:500;color:var(--pr-muted)}
.prova-kv{display:grid;grid-template-columns:110px 1fr;gap:3px 10px;padding:0 10px 9px;font:12px/1.5 var(--pr-mono);color:var(--pr-muted);margin:0}
.prova-kv dt{font-family:var(--pr-font);font-weight:600;color:var(--pr-text);margin:0}.prova-kv dd{margin:0;overflow-wrap:anywhere}
.prova-err{color:var(--pr-error)}
.prova-dlg footer{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--pr-line-soft);background:var(--pr-foot)}
.prova-note{font-size:12px;color:var(--pr-muted);margin-right:auto}
.prova-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--pr-control);background:var(--pr-panel);color:var(--pr-text);font:inherit;
font-weight:600;cursor:pointer;white-space:nowrap}
.prova-btn:hover:not(:disabled){border-color:var(--pr-accent)}
.prova-btn.prova-primary{background:var(--pr-accent);border-color:var(--pr-accent);color:#fff}
.prova-btn.prova-primary:hover:not(:disabled){background:var(--pr-accent-hover)}
.prova-btn:disabled{opacity:.55;cursor:default}
.prova-spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;display:inline-block;vertical-align:-2px;
margin-right:6px;animation:prova-spin .8s linear infinite}
@keyframes prova-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.prova-spin{animation:none}}
.prova-done{padding:22px 16px;text-align:center}
.prova-tick{width:44px;height:44px;border-radius:50%;background:var(--pr-soft);color:var(--pr-accent);display:grid;place-items:center;margin:0 auto 10px;font-size:22px}
.prova-done h4{margin:0 0 4px;font-size:16px;color:var(--pr-text)}.prova-done p{margin:0;color:var(--pr-muted)}
.prova-done code,.prova-id{font:600 13px var(--pr-mono);color:var(--pr-text)}
.prova-banner{border-radius:8px;padding:9px 11px;font-size:13px}
.prova-banner.prova-bad{background:var(--pr-error-bg);border:1px solid var(--pr-error-line);color:var(--pr-error)}
.prova-banner.prova-warn{background:var(--pr-warn-bg);border:1px solid var(--pr-warn-line);color:var(--pr-warn-text)}
.prova-mine{padding:8px 14px 14px;overflow:auto}
.prova-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:9px 6px;border-bottom:1px solid var(--pr-line-soft)}
.prova-item:last-child{border:0}.prova-t{font-weight:600;color:var(--pr-text)}.prova-m{font-size:12px;color:var(--pr-muted)}
.prova-item .prova-id{font-weight:400;font-size:12px;color:var(--pr-faint)}
.prova-pill{font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;white-space:nowrap}
.prova-p-received{background:var(--pr-idle-bg);color:var(--pr-idle-text)}.prova-p-working{background:var(--pr-blue-bg);color:var(--pr-blue-text)}
.prova-p-fixed{background:var(--pr-soft);color:var(--pr-soft-text)}.prova-p-closed{background:var(--pr-line-soft);color:var(--pr-muted)}
.prova-empty{padding:18px 6px;color:var(--pr-muted);text-align:center}
.prova-new{margin-left:auto;height:28px}.prova-new+.prova-x{margin-left:0}
.prova-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.prova-dot{position:absolute;right:-2px;top:-2px;width:9px;height:9px;border-radius:50%;background:#d97706;border:2px solid #fff;pointer-events:none}
.prova-n{margin-left:auto;font-size:11px;font-weight:700;background:#fdecc8;color:#8a4a12;border-radius:999px;padding:1px 7px}
@media (max-width:520px){.prova-rp{padding:12px;justify-content:center}.prova-dlg{width:100%}.prova-kv{grid-template-columns:90px 1fr}}
`;

// ---- recent errors: console errors and failed requests, newest kept -----------------------------------

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
// Addresses lose their query and fragment: a token or a search term in a URL never leaves the machine.
const scrubUrl = (text) => String(text).replace(/((?:https?:\/\/|\/)[^\s?#'"]*)[?#][^\s'"]*/g, '$1');

export function createErrorRing({ size = 20, max = 300 } = {}) {
  const items = [];
  const push = (text) => {
    const line = clip(scrubUrl(String(text)).replace(/\s+/g, ' ').trim(), max);
    if (!line) return;
    items.push(line);
    if (items.length > size) items.splice(0, items.length - size);
  };
  const describe = (value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (err) { return String(value); }
  };
  let installed = null;
  return {
    push,
    list: () => [...items],
    clear: () => { items.length = 0; },
    install(win = globalThis) {
      if (installed) return this;
      const originalError = win.console?.error;
      const originalFetch = win.fetch;
      const onError = (event) => push(`${event.message || 'Error'}${event.filename ? ` (${event.filename.split(/[?#]/)[0].split('/').pop()}:${event.lineno})` : ''}`);
      const onRejection = (event) => push(`Unhandled rejection: ${describe(event.reason)}`);
      win.addEventListener?.('error', onError);
      win.addEventListener?.('unhandledrejection', onRejection);
      if (originalError) {
        win.console.error = (...args) => {
          push(args.map(describe).join(' '));
          return originalError.apply(win.console, args);
        };
      }
      if (originalFetch) {
        win.fetch = async (input, init) => {
          const method = (init?.method || input?.method || 'GET').toUpperCase();
          const url = typeof input === 'string' ? input : input?.url ?? String(input);
          const path = scrubUrl(url).replace(/^https?:\/\/[^/]+/, '');
          try {
            const response = await originalFetch.call(win, input, init);
            if (response.status >= 400) push(`${method} ${path} → ${response.status}`);
            return response;
          } catch (err) {
            if (err?.name !== 'AbortError') push(`${method} ${path} → network error`);
            throw err;
          }
        };
      }
      installed = () => {
        win.removeEventListener?.('error', onError);
        win.removeEventListener?.('unhandledrejection', onRejection);
        if (originalError) win.console.error = originalError;
        if (originalFetch) win.fetch = originalFetch;
      };
      return this;
    },
    uninstall() { installed?.(); installed = null; },
  };
}

// ---- small helpers ----------------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function describeBrowser(ua = globalThis.navigator?.userAgent ?? '') {
  const pick = (re, name) => { const m = re.exec(ua); return m ? `${name} ${m[1]}` : null; };
  const browser = pick(/Edg\/(\d+(?:\.\d+)?)/, 'Edge') ?? pick(/OPR\/(\d+)/, 'Opera') ?? pick(/Firefox\/(\d+(?:\.\d+)?)/, 'Firefox')
    ?? pick(/Chrome\/(\d+)/, 'Chrome') ?? pick(/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari') ?? 'Unknown browser';
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua);
  const win = /Windows NT (\d+\.\d+)/.exec(ua);
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : mac ? `macOS ${mac[1].replace(/_/g, '.')}` : win ? (win[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${win[1]}`)
      : /Linux/.test(ua) ? 'Linux' : /CrOS/.test(ua) ? 'ChromeOS' : 'Unknown OS';
  return { browser, os };
}

// "view: refused ×2" — identical lines counted, newest last.
export function groupErrors(lines) {
  const counts = new Map();
  lines.forEach((line) => counts.set(line, (counts.get(line) ?? 0) + 1));
  return [...counts].map(([line, n]) => (n > 1 ? `${line} ×${n}` : line));
}

const kb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function when(iso) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A screenshot larger than the cap is scaled down once (JPEG); one that still does not fit is refused.
async function fitScreenshot(file) {
  if (file.size <= SCREENSHOT_MAX && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return file;
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob || blob.size > SCREENSHOT_MAX) return null;
  return new File([blob], (file.name || 'screenshot').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

const STATUS_WORD = { received: 'Received', working: 'Being worked on', fixed: 'Fixed', closed: 'Closed' };

// ---- the reporter ------------------------------------------------------------------------------------

export function createReporter(options) {
  const opts = {
    reportUrl: '/api/report',
    mineUrl: '/api/reports/mine',
    headers: () => ({}),
    user: null,
    app: { name: 'this app', version: '', host: globalThis.location?.host ?? '' },
    team: 'the developers',
    page: () => globalThis.document?.title ?? '',
    errors: () => [],
    anchor: 'top-right',
    theme: 'light',
    fetch: (...args) => globalThis.fetch(...args),
    root: null,
    ...options,
  };
  const listeners = new Set();
  const draft = { what: '', expected: '', steps: '', shot: null };
  let news = 0;
  let overlay = null;
  let returnFocus = null;
  let retryTimer = null;
  let bound = null;

  // A page whose CSP forbids inline <style> (style-src 'self') passes `stylesheet`: the same CSS served as a file.
  const injectCss = () => {
    if (opts.css === false || document.getElementById('prova-report-css')) return;
    document.head.append(opts.stylesheet
      ? el('link', { id: 'prova-report-css', rel: 'stylesheet', href: opts.stylesheet })
      : el('style', { id: 'prova-report-css', text: CSS }));
  };

  const call = async (method, url, body) => {
    const headers = { Accept: 'application/json', ...(await opts.headers()) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await opts.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
    return { status: response.status, ok: response.ok, json };
  };

  const setNews = (count) => {
    news = count;
    if (count > 0) injectCss();
    if (bound?.avatar) {
      const host = bound.avatar;
      let dot = host.querySelector(':scope > .prova-dot');
      if (count > 0 && !dot) {
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        dot = el('span', { class: 'prova-dot', title: 'A report has news', 'aria-hidden': 'true' });
        host.append(dot);
      } else if (count === 0 && dot) dot.remove();
      host.toggleAttribute('data-prova-news', count > 0);
    }
    if (bound?.mineRow) {
      let badge = bound.mineRow.querySelector('.prova-n');
      if (count > 0) {
        if (!badge) { badge = el('span', { class: 'prova-n' }); bound.mineRow.append(badge); }
        badge.textContent = `${count} new`;
      } else badge?.remove();
    }
    listeners.forEach((fn) => fn({ news: count }));
  };

  const close = () => {
    clearTimeout(retryTimer);
    overlay?.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
    const target = returnFocus;
    returnFocus = null;
    target?.focus?.();
  };

  function onKey(event) {
    if (!overlay) return;
    if (event.key === 'Escape' && !overlay.hasAttribute('data-busy')) { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button, textarea, summary, a[href], input:not([type=file])')].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const frame = (title, { label, mine = false } = {}) => {
    injectCss();
    if (overlay) overlay.remove();
    returnFocus = returnFocus ?? document.activeElement;
    const dlg = el('div', { class: 'prova-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': label ?? title, tabindex: '-1', 'data-prova-dialog': mine ? 'mine' : 'report' });
    overlay = el('div', { class: `prova-rp${opts.anchor === 'center' ? ' prova-center' : ''}${opts.theme === 'dark' ? ' prova-dark' : ''}`, 'data-prova-report': '' }, dlg);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay && !overlay.hasAttribute('data-busy')) close(); });
    (opts.root ?? document.body).append(overlay);
    document.addEventListener('keydown', onKey, true);
    return dlg;
  };

  const header = (title, extra = null) => el('header', {}, el('h3', { text: title }), extra,
    el('button', { type: 'button', class: 'prova-x', 'aria-label': 'Close', 'data-prova-close': '', onclick: () => { if (!overlay?.hasAttribute('data-busy')) close(); } }, '×'));

  const technical = () => {
    const { browser, os } = describeBrowser();
    return { page: clip(String(opts.page() ?? ''), 300), browser, os, errors: groupErrors(opts.errors() ?? []).slice(-30).map((line) => clip(line, 500)) };
  };

  const draftText = () => [
    `What happened:\n${draft.what}`,
    draft.expected ? `What you expected:\n${draft.expected}` : null,
    draft.steps ? `Steps:\n${draft.steps}` : null,
  ].filter(Boolean).join('\n\n');

  const copyText = async (button) => {
    try {
      await navigator.clipboard.writeText(draftText());
      button.textContent = 'Copied';
    } catch (err) {
      button.textContent = 'Copy refused';
    }
  };

  function openReport({ banner = null } = {}) {
    clearTimeout(retryTimer);
    const dlg = frame('Report a problem');
    const what = el('textarea', { name: 'what_happened', required: true, 'aria-required': 'true', maxlength: '4000' });
    const expected = el('textarea', { name: 'expected', class: 'prova-small', maxlength: '2000' });
    const steps = el('textarea', { name: 'steps', class: 'prova-small', maxlength: '4000' });
    what.value = draft.what; expected.value = draft.expected; steps.value = draft.steps;
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, 'data-prova-file': '' });
    const drop = el('div', { class: 'prova-drop', 'data-prova-drop': '' });
    const shotNote = el('p', { class: 'prova-m prova-err', role: 'status', hidden: true });
    const tech = technical();

    const send = el('button', { type: 'button', class: 'prova-btn prova-primary', 'data-prova-send': '' }, 'Send');
    const cancel = el('button', { type: 'button', class: 'prova-btn', 'data-prova-cancel': '', onclick: close }, 'Cancel');
    const copy = el('button', { type: 'button', class: 'prova-btn', 'data-prova-copy': '', hidden: true }, 'Copy text');
    copy.addEventListener('click', () => copyText(copy));
    const bannerBox = el('div', { class: 'prova-banner', role: 'alert', hidden: true, 'data-prova-banner': '' });
    const note = el('span', { class: 'prova-note', text: `Goes to ${opts.team}` });

    const sync = () => {
      draft.what = what.value; draft.expected = expected.value; draft.steps = steps.value;
      if (!dlg.hasAttribute('data-limited')) send.disabled = what.value.trim().length < MIN_TEXT;
    };
    [what, expected, steps].forEach((field) => field.addEventListener('input', sync));

    const showBanner = (kind, text) => {
      bannerBox.className = `prova-banner ${kind === 'warn' ? 'prova-warn' : 'prova-bad'}`;
      bannerBox.textContent = text;
      bannerBox.hidden = false;
      copy.hidden = false;
      note.textContent = '';
    };

    const renderDrop = () => {
      drop.replaceChildren();
      if (draft.shot) {
        const url = URL.createObjectURL(draft.shot);
        drop.append(el('img', { class: 'prova-thumb', src: url, alt: 'Screenshot to send' }),
          el('span', {}, `${draft.shot.name || 'screenshot'} · ${kb(draft.shot.size)}`, el('br'),
            el('button', { type: 'button', class: 'prova-link', 'data-prova-remove': '', onclick: () => { draft.shot = null; renderDrop(); } }, 'Remove')));
      } else {
        drop.append(el('span', { class: 'prova-thumb', 'aria-hidden': 'true' }), el('span', { text: 'Screenshot (optional)' }));
      }
      drop.append(el('span', { class: 'prova-pick' }, 'Paste, drop or ',
        el('button', { type: 'button', class: 'prova-link', 'data-prova-choose': '', onclick: () => fileInput.click() }, 'choose')));
    };
    const takeFile = async (file) => {
      shotNote.hidden = true;
      if (!file || !file.type.startsWith('image/')) { shotNote.textContent = 'Only an image can be attached.'; shotNote.hidden = false; return; }
      const fitted = await fitScreenshot(file).catch((err) => { console.warn('prova report: the screenshot could not be scaled', err); return null; });
      if (!fitted) { shotNote.textContent = `The screenshot is ${kb(file.size)}; one image of at most 2 MB can be attached.`; shotNote.hidden = false; return; }
      draft.shot = fitted;
      renderDrop();
    };
    fileInput.addEventListener('change', () => takeFile(fileInput.files[0]));
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('prova-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('prova-over'));
    drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('prova-over'); takeFile(event.dataTransfer.files[0]); });
    dlg.addEventListener('paste', (event) => {
      const item = [...(event.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (item) { event.preventDefault(); takeFile(item.getAsFile()); }
    });
    renderDrop();

    const errorsLine = tech.errors.length
      ? el('dd', { class: 'prova-err', 'data-prova-errors': '' }, tech.errors.slice(-3).join(' · '), tech.errors.length > 3 ? ` (+${tech.errors.length - 3} more)` : '')
      : el('dd', { 'data-prova-errors': '', text: 'none' });
    const kv = el('dl', { class: 'prova-kv' },
      el('dt', { text: 'You' }), el('dd', { text: opts.user ?? `user of ${opts.app.name}` }),
      el('dt', { text: 'App' }), el('dd', { text: [`${opts.app.name} ${opts.app.version}`.trim(), opts.app.host].filter(Boolean).join(' · ') }),
      el('dt', { text: 'Page' }), el('dd', { text: tech.page || '—' }),
      el('dt', { text: 'Browser' }), el('dd', { text: `${tech.browser} · ${tech.os}` }),
      el('dt', { text: 'Recent errors' }), errorsLine);
    const details = el('details', { class: 'prova-tech', 'data-prova-sent-with': '' },
      el('summary', {}, 'Sent with it', el('span', { text: 'no document content' })), kv);

    const field = (text, input, required = false) => el('label', {}, el('span', { class: required ? 'prova-req' : null, text }), input);
    dlg.append(header('Report a problem'),
      el('div', { class: 'prova-rows' }, bannerBox,
        field('What happened', what, true), field('What you expected', expected), field('Steps', steps),
        drop, shotNote, fileInput, details),
      el('footer', {}, note, copy, cancel, send));

    const setBusy = (busy) => {
      overlay.toggleAttribute('data-busy', busy);
      [what, expected, steps, cancel].forEach((n) => { n.disabled = busy; });
      drop.querySelectorAll('button').forEach((n) => { n.disabled = busy; });
      send.disabled = busy;
      send.replaceChildren(...(busy ? [el('span', { class: 'prova-spin', 'aria-hidden': 'true' }), 'Sending'] : [dlg.hasAttribute('data-failed') ? 'Send again' : 'Send']));
    };

    const limited = (text, retryAfter) => {
      dlg.setAttribute('data-limited', '');
      showBanner('warn', text);
      send.disabled = true;
      if (retryAfter > 0 && retryAfter < 6 * 3600) {
        retryTimer = setTimeout(() => { dlg.removeAttribute('data-limited'); bannerBox.hidden = true; sync(); }, retryAfter * 1000);
      }
    };

    send.addEventListener('click', async () => {
      sync();
      if (draft.what.trim().length < MIN_TEXT) return;
      bannerBox.hidden = true;
      setBusy(true);
      let answer;
      try {
        const body = {
          what_happened: draft.what.trim(),
          ...(draft.expected.trim() ? { expected: draft.expected.trim() } : {}),
          ...(draft.steps.trim() ? { steps: draft.steps.trim() } : {}),
          technical: technical(),
          ...(draft.shot ? { screenshot: { media_type: draft.shot.type, name: draft.shot.name || 'screenshot', data: await readAsBase64(draft.shot) } } : {}),
        };
        answer = await call('POST', opts.reportUrl, body);
      } catch (err) {
        answer = null;
      }
      if (!overlay) return;
      setBusy(false);
      if (answer?.ok && answer.json?.id) {
        const id = answer.json.id;
        draft.what = ''; draft.expected = ''; draft.steps = ''; draft.shot = null;
        showSent(id);
        refresh();
        return;
      }
      dlg.setAttribute('data-failed', '');
      send.textContent = 'Send again';
      const message = answer?.json?.error;
      if (answer?.status === 429) limited(message ?? 'Too many reports. Try again later.', Number(answer.json?.retry_after) || 0);
      else if (!answer || answer.status >= 500 || answer.status === 0) showBanner('bad', 'Could not reach the report service. Your report is kept — Send again.');
      else showBanner('bad', `${message ?? `The report was refused (${answer.status}).`} Your report is kept.`);
      sync();
      if (dlg.hasAttribute('data-limited')) send.disabled = true;
    });

    if (banner) showBanner(banner.kind, banner.text);
    sync();
    what.focus();
    return dlg;
  }

  function showSent(id) {
    const dlg = frame('Report a problem', { label: 'Report sent' });
    const mineLink = el('button', { type: 'button', class: 'prova-link', 'data-prova-open-mine': '', onclick: () => openMine() }, 'My reports');
    const done = el('button', { type: 'button', class: 'prova-btn prova-primary', 'data-prova-done': '', onclick: close }, 'Done');
    dlg.append(el('div', { class: 'prova-done', role: 'status', 'data-prova-sent': id },
      el('div', { class: 'prova-tick', 'aria-hidden': 'true', text: '✓' }),
      el('h4', { text: 'Sent — thank you' }),
      el('p', {}, 'Report ', el('code', { text: id }), '. Follow it in ', mineLink, '.')),
    el('footer', {}, el('span', { class: 'prova-note' }), done));
    done.focus();
  }

  function itemOf(report) {
    const status = STATUS_WORD[report.status] ? report.status : 'received';
    const meta = [];
    if (status === 'fixed' && report.fixed_in) meta.push(`Fixed in ${report.fixed_in}`);
    if (status === 'closed' && report.reason) meta.push(report.reason);
    const ids = report.issue ? `${report.id} → ${report.issue}` : report.id;
    return el('div', { class: 'prova-item', 'data-prova-item': report.id, 'data-status': status },
      el('span', { class: `prova-pill prova-p-${status}`, text: STATUS_WORD[status] }),
      el('div', {}, el('div', { class: 'prova-t', text: report.title }),
        el('div', { class: 'prova-m' }, meta.length ? `${meta.join(' · ')} · ` : '', el('span', { class: 'prova-id', text: ids }),
          report.count > 1 ? ` · seen ${report.count} times` : '')),
      el('span', { class: 'prova-m', text: when(report.reported_at) }));
  }

  async function openMine() {
    clearTimeout(retryTimer);
    const dlg = frame('My reports', { mine: true });
    const list = el('div', { class: 'prova-mine', 'data-prova-mine': '', 'aria-live': 'polite' }, el('p', { class: 'prova-empty', text: 'Loading…' }));
    const fresh = el('button', { type: 'button', class: 'prova-btn prova-new', 'data-prova-new': '', onclick: () => openReport() }, 'New report');
    dlg.append(header('My reports', fresh), list);
    dlg.focus();
    let answer = null;
    try {
      answer = await call('GET', `${opts.mineUrl}${opts.mineUrl.includes('?') ? '&' : '?'}seen=1`);
    } catch (err) {
      answer = null;
    }
    if (!overlay || !list.isConnected) return;
    if (!answer?.ok) {
      const retry = el('button', { type: 'button', class: 'prova-link', onclick: () => openMine() }, 'Try again');
      list.replaceChildren(el('div', { class: 'prova-banner prova-bad', role: 'alert' }, 'Could not load your reports. ', retry));
      return;
    }
    const reports = answer.json?.reports ?? [];
    list.replaceChildren(...(reports.length ? reports.map(itemOf) : [el('p', { class: 'prova-empty', text: 'No reports yet.' })]));
    setNews(0);
  }

  // { news, ok, status, code }: an app hides its rows when the relay says reporting is not set up (404).
  async function refresh() {
    try {
      const answer = await call('GET', opts.mineUrl);
      if (answer.ok) setNews(Number(answer.json?.news) || 0);
      return { news, ok: answer.ok, status: answer.status, code: answer.json?.code ?? null };
    } catch (err) {
      return { news, ok: false, status: 0, code: 'unreachable' };
    }
  }

  // Binds the rows of the app's own user menu; `unbind()` (and destroy) takes the listeners, dot and badge away.
  function unbind() {
    if (!bound) return;
    bound.listeners.forEach(([node, fn]) => node.removeEventListener('click', fn));
    bound.avatar?.querySelector(':scope > .prova-dot')?.remove();
    bound.avatar?.removeAttribute('data-prova-news');
    bound.mineRow?.querySelector('.prova-n')?.remove();
    bound = null;
  }

  // No stylesheet is loaded until something is shown (a dot, a badge, a dialog): an app where reporting is
  // off makes no extra request at all.
  function bindMenu({ reportRow = null, mineRow = null, avatar = null, onOpen = null } = {}) {
    unbind();
    const handle = (fn) => (event) => { event.preventDefault(); onOpen?.(); returnFocus = avatar ?? event.currentTarget; fn(); };
    const listeners = [[reportRow, handle(() => openReport())], [mineRow, handle(() => openMine())]].filter(([node]) => node);
    listeners.forEach(([node, fn]) => node.addEventListener('click', fn));
    bound = { reportRow, mineRow, avatar, listeners };
    setNews(news);
    return refresh();
  }

  return {
    open: () => openReport(),
    openMine,
    refresh,
    close,
    bindMenu,
    unbind,
    get news() { return news; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get isOpen() { return Boolean(overlay); },
    destroy() { close(); unbind(); listeners.clear(); },
  };
}
