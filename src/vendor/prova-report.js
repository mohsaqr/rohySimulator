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
//     subjectsUrl: '/api/report/subjects',   // 1.1.0: "This is about" (the app, or one of the owner's R packages);
//                                            // 1.2.0: two steps — the app or "An R package", then "Which package"
//     chunks: async () => [{ label: '#3 · plot-results', engine: 'r', code, output }],   // 1.1.0, optional
//     user: 'beyza', app: { name: 'Beatrina SE', version: '1.5.18', host: location.host },
//     team: 'the Beatrina developers', page: () => document.title, errors: () => ring.list(),
//     stylesheet: '/report.css',   // only where the page's CSP forbids an inline <style>
//   });
//   reporter.bindMenu({ reportRow, mineRow, avatar });   // rows the app's own user menu already has
//   // 1.3.0: a third, optional row opens the dialog as a feature request; the dialog itself switches between
//   // "Problem" and "Feature request", and takes up to five screenshots (each ≤ 2 MB, 6 MB together).
//   reporter.bindMenu({ reportRow, featureRow, mineRow, avatar });  ·  reporter.open({ kind: 'feature' })
//   // A feature request sends no recent errors and no chunk; it lands on Prova's Requests list, not in Issues.
//   // 1.4.0: each report in My reports opens its conversation — what the team wrote to this person (a
//   // message, or a question with answer buttons) and a box to write back. The relay mounts
//   // GET/POST <app>/api/reports/:id/messages (relay.messages / relay.reply); `messagesUrl` names it.
//
// Nothing here sets innerHTML: every value is text. Document content is never collected on its own: the one
// exception is a chunk the HOST APP offers through `chunks` AND the person picks AND ticks "Include this
// chunk's code and error" for (unticked by default); "Sent with it" then shows exactly the text that goes.

export const VERSION = '1.4.0';
export const MESSAGE_MAX = 4000;
export const SCREENSHOT_MAX = 2 * 1024 * 1024;
export const SCREENSHOTS_MAX = 5;
export const SCREENSHOTS_TOTAL = 6 * 1024 * 1024;
export const KINDS = ['problem', 'feature'];
export const MIN_TEXT = 10;
export const CHUNK_MAX = { label: 200, engine: 20, code: 20000, output: 20000 };

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
.prova-rp [hidden]{display:none!important}
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
.prova-res{margin:3px 0 2px;font-size:13px;line-height:1.4;color:var(--pr-text);white-space:pre-line}
.prova-item .prova-id{font-weight:400;font-size:12px;color:var(--pr-faint)}
.prova-pill{font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;white-space:nowrap}
.prova-p-received{background:var(--pr-idle-bg);color:var(--pr-idle-text)}.prova-p-working{background:var(--pr-blue-bg);color:var(--pr-blue-text)}
.prova-p-fixed{background:var(--pr-soft);color:var(--pr-soft-text)}.prova-p-closed{background:var(--pr-line-soft);color:var(--pr-muted)}
.prova-empty{padding:18px 6px;color:var(--pr-muted);text-align:center}
.prova-new{margin-left:auto;height:28px}.prova-new+.prova-x{margin-left:0}
.prova-rp select{font:inherit;font-weight:400;color:var(--pr-text);border:1px solid var(--pr-control);border-radius:7px;padding:6px 8px;background:var(--pr-panel);width:100%;margin:0}
.prova-rp select:focus,.prova-rp input[type=checkbox]:focus-visible{outline:2px solid var(--pr-accent);outline-offset:1px}
.prova-rp label.prova-check{display:flex;align-items:flex-start;gap:7px;font-size:13px;font-weight:600;color:var(--pr-text)}
.prova-rp label.prova-check input{margin:2px 0 0;flex:none;accent-color:var(--pr-accent)}
.prova-chunk{border:1px solid var(--pr-line);border-radius:8px;padding:8px 10px;display:grid;gap:6px}
.prova-pre{margin:0;max-height:140px;overflow:auto;font:12px/1.45 var(--pr-mono);color:var(--pr-text);background:var(--pr-foot);border:1px solid var(--pr-line-soft);
border-radius:6px;padding:6px 8px;white-space:pre-wrap;overflow-wrap:anywhere}
.prova-pre.prova-out{color:var(--pr-muted)}
.prova-sent-chunk{padding:0 10px 9px;display:grid;gap:6px}
.prova-chunk-row{display:grid;gap:6px}
.prova-about{display:grid;gap:10px}
.prova-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.prova-dot{position:absolute;right:-2px;top:-2px;width:9px;height:9px;border-radius:50%;background:#d97706;border:2px solid #fff;pointer-events:none}
.prova-n{margin-left:auto;font-size:11px;font-weight:700;background:#fdecc8;color:#8a4a12;border-radius:999px;padding:1px 7px}
.prova-kind{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--pr-control);border-radius:8px;overflow:hidden}
.prova-kind button{border:0;background:var(--pr-panel);color:var(--pr-muted);font:inherit;font-weight:600;padding:7px 8px;cursor:pointer;margin:0}
.prova-kind button+button{border-left:1px solid var(--pr-control)}
.prova-kind button[aria-checked=true]{background:var(--pr-soft);color:var(--pr-soft-text)}
.prova-kind button:focus-visible{outline:2px solid var(--pr-accent);outline-offset:-2px}
.prova-drop{flex-wrap:wrap}
.prova-shots{display:flex;flex-wrap:wrap;gap:10px}
.prova-shot{position:relative;display:grid;gap:2px;width:84px;font-size:11px;color:var(--pr-muted)}
.prova-shot span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prova-rm{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:1px solid var(--pr-control);background:var(--pr-panel);
color:var(--pr-text);font:inherit;font-size:13px;line-height:1;cursor:pointer;padding:0;display:grid;place-items:center}
.prova-rm:hover{border-color:var(--pr-accent)}
.prova-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--pr-blue-text);background:var(--pr-blue-bg);border-radius:4px;
padding:1px 5px;margin-right:6px;vertical-align:1px}
.prova-talk{display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap}
.prova-q-pill{font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px;background:#fdecc8;color:#8a4a12}
.prova-thread{list-style:none;margin:0;padding:10px 14px;display:grid;gap:10px;overflow:auto}
.prova-msg{max-width:88%;border:1px solid var(--pr-line);border-radius:10px;padding:8px 10px;background:var(--pr-panel)}
.prova-msg.prova-you{justify-self:end;background:var(--pr-soft);border-color:var(--pr-soft)}
.prova-msg.prova-q{border-color:var(--pr-warn-line);background:var(--pr-warn-bg)}
.prova-msg .prova-who{font-size:12px;font-weight:700;color:var(--pr-text)}.prova-msg .prova-when{font-size:11px;color:var(--pr-faint);margin-left:6px;font-weight:400}
.prova-msg p{margin:3px 0 0;white-space:pre-line;overflow-wrap:anywhere;color:var(--pr-text)}
.prova-msg textarea{margin-top:6px}
.prova-choices{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.prova-choices .prova-btn{height:28px;padding:0 10px}
.prova-compose{border-top:1px solid var(--pr-line-soft);padding:10px 14px;display:grid;gap:6px;margin:0}
.prova-about-thread{padding:8px 14px 0;margin:0;font-size:12px;color:var(--pr-muted)}
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

const STATUS_WORD = { received: 'Received', working: 'Being worked on', fixed: 'Resolved', closed: 'Closed' };

// The words of each kind of report: the dialog's title, its two text fields, its Send button.
const KIND_TEXT = {
  problem: { title: 'Report a problem', choice: 'Problem', what: 'What happened', expected: 'What you expected', send: 'Send', sent: 'Report' },
  feature: { title: 'Request a feature', choice: 'Feature request', what: 'What would you like', expected: 'Why would it help', send: 'Send request', sent: 'Request' },
};

// Which screenshots fit: at most SCREENSHOTS_MAX, together at most SCREENSHOTS_TOTAL. `files` are already
// scaled (fitScreenshot); returns the ones to keep and a note for each refused one.
export function addScreenshots(current, files) {
  return files.reduce(({ shots, notes }, file) => {
    if (shots.length >= SCREENSHOTS_MAX) return { shots, notes: [...notes, `At most ${SCREENSHOTS_MAX} screenshots can be sent.`] };
    const total = shots.reduce((sum, shot) => sum + shot.size, 0);
    if (total + file.size > SCREENSHOTS_TOTAL) return { shots, notes: [...notes, `${file.name || 'A screenshot'} does not fit: the screenshots together may be at most ${SCREENSHOTS_TOTAL / 1048576} MB.`] };
    return { shots: [...shots, file], notes };
  }, { shots: [...current], notes: [] });
}

// ---- a mentioned chunk -------------------------------------------------------------------------------

const flat = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

// The chunks the host app offers, as plain text fields; anything else in an entry is ignored.
export function normaliseChunks(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c === 'object').slice(0, 500).map((c, i) => ({
    label: flat(c.label) || `Chunk ${i + 1}`,
    engine: flat(c.engine) || 'text',
    code: typeof c.code === 'string' ? c.code : String(c.code ?? ''),
    output: typeof c.output === 'string' ? c.output : String(c.output ?? ''),
  }));
}

// Exactly what is sent for a chunk the person ticked: each field cut to Prova's cap — code keeps its start,
// output its end (where an error usually is) — so "Sent with it" and the request carry the same text.
export function chunkToSend(chunk) {
  const head = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const tail = (text, max) => (text.length > max ? `…${text.slice(text.length - max + 1)}` : text);
  return {
    label: head(flat(chunk.label), CHUNK_MAX.label),
    engine: head(flat(chunk.engine), CHUNK_MAX.engine),
    code: head(chunk.code, CHUNK_MAX.code),
    output: tail(chunk.output, CHUNK_MAX.output),
  };
}

const wasCut = (chunk) => chunk.code.length > CHUNK_MAX.code || chunk.output.length > CHUNK_MAX.output;

// ---- what a report is about: two steps ----------------------------------------------------------------

// The words for a kind of subject that is chosen in two steps ("An R package", then "Which package"). Kind
// `app` is never grouped: the app itself and any other app are chosen directly in the first select.
const KIND_WORDS = {
  'r-package': { option: 'An R package', which: 'Which package', choose: 'Choose a package', noun: 'package', suffix: /\s*\(R package\)\s*$/i },
};
export const kindWords = (kind) => KIND_WORDS[kind] ?? { option: `Another ${kind}`, which: `Which ${kind}`, choose: `Choose a ${kind}`, noun: kind, suffix: null };
const GROUP = 'kind:';

// The two selects from the relay's flat list (`[{ id, label, kind }]`, the app's own product first):
// `choices` fill "This is about" — the app, other apps, then one entry per other kind; `groups` fill the
// second select of such a kind, sorted by name, each label without its "(R package)" ending.
export function aboutChoices(subjects) {
  const list = Array.isArray(subjects) ? subjects.filter((x) => x && typeof x.id === 'string' && typeof x.label === 'string') : [];
  if (!list.length) return { own: null, choices: [], groups: new Map() };
  const [own, ...rest] = list;
  const groups = new Map();
  rest.filter((x) => x.kind !== 'app').forEach((x) => {
    const kind = typeof x.kind === 'string' && x.kind ? x.kind : 'other';
    const words = kindWords(kind);
    const name = (words.suffix ? x.label.replace(words.suffix, '') : x.label) || x.label;
    groups.set(kind, [...(groups.get(kind) ?? []), { id: x.id, label: x.label, name }]);
  });
  groups.forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)));
  const choices = [
    { value: own.id, label: own.label },
    ...rest.filter((x) => x.kind === 'app').map((x) => ({ value: x.id, label: x.label })),
    ...[...groups.keys()].map((kind) => ({ value: `${GROUP}${kind}`, label: kindWords(kind).option, kind })),
  ];
  return { own: own.id, choices, groups };
}

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
    subjectsUrl: '/api/report/subjects',
    // 1.4.0: one report's conversation; "{id}" is replaced by the report's id (AR-12).
    messagesUrl: '/api/reports/{id}/messages',
    chunks: null,
    anchor: 'top-right',
    theme: 'light',
    fetch: (...args) => globalThis.fetch(...args),
    root: null,
    ...options,
  };
  const listeners = new Set();
  // `about` is the first select's value (an app's id or "kind:<kind>"); `subject` the second select's choice.
  const draft = { kind: 'problem', what: '', expected: '', steps: '', shots: [], about: null, subject: null, chunk: null, includeChunk: false };
  // One object URL per screenshot shown, released when the screenshot is removed or sent.
  const thumbs = new WeakMap();
  const thumbOf = (file) => { if (!thumbs.has(file)) thumbs.set(file, URL.createObjectURL(file)); return thumbs.get(file); };
  const dropThumb = (file) => { if (thumbs.has(file)) { URL.revokeObjectURL(thumbs.get(file)); thumbs.delete(file); } };
  let subjectList = null;
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
    const focusable = [...overlay.querySelectorAll('button, textarea, select, summary, a[href], input:not([type=file])')].filter((n) => !n.disabled && n.offsetParent !== null);
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
    `${KIND_TEXT[draft.kind].what}:\n${draft.what}`,
    draft.expected ? `${KIND_TEXT[draft.kind].expected}:\n${draft.expected}` : null,
    draft.steps && draft.kind === 'problem' ? `Steps:\n${draft.steps}` : null,
  ].filter(Boolean).join('\n\n');

  const copyText = async (button) => {
    try {
      await navigator.clipboard.writeText(draftText());
      button.textContent = 'Copied';
    } catch (err) {
      button.textContent = 'Copy refused';
    }
  };

  function openReport({ banner = null, kind = null } = {}) {
    clearTimeout(retryTimer);
    if (KINDS.includes(kind)) draft.kind = kind;
    const dlg = frame(KIND_TEXT[draft.kind].title);
    const what = el('textarea', { name: 'what_happened', required: true, 'aria-required': 'true', maxlength: '4000' });
    const expected = el('textarea', { name: 'expected', class: 'prova-small', maxlength: '2000' });
    const steps = el('textarea', { name: 'steps', class: 'prova-small', maxlength: '4000' });
    what.value = draft.what; expected.value = draft.expected; steps.value = draft.steps;
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, 'data-prova-file': '' });
    const drop = el('div', { class: 'prova-drop', 'data-prova-drop': '' });
    const shotNote = el('p', { class: 'prova-m prova-err', role: 'status', hidden: true, 'data-prova-shot-note': '' });
    const tech = technical();

    const send = el('button', { type: 'button', class: 'prova-btn prova-primary', 'data-prova-send': '' }, 'Send');
    const cancel = el('button', { type: 'button', class: 'prova-btn', 'data-prova-cancel': '', onclick: close }, 'Cancel');
    const copy = el('button', { type: 'button', class: 'prova-btn', 'data-prova-copy': '', hidden: true }, 'Copy text');
    copy.addEventListener('click', () => copyText(copy));
    const bannerBox = el('div', { class: 'prova-banner', role: 'alert', hidden: true, 'data-prova-banner': '' });
    const note = el('span', { class: 'prova-note', text: `Goes to ${opts.team}` });

    // Set once the subjects arrive: true while a kind is chosen in "This is about" but none of its subjects.
    let needsPick = () => false;
    const sync = () => {
      draft.what = what.value; draft.expected = expected.value; draft.steps = steps.value;
      if (!dlg.hasAttribute('data-limited')) send.disabled = what.value.trim().length < MIN_TEXT || needsPick();
    };
    [what, expected, steps].forEach((field) => field.addEventListener('input', sync));

    const showBanner = (kind, text) => {
      bannerBox.className = `prova-banner ${kind === 'warn' ? 'prova-warn' : 'prova-bad'}`;
      bannerBox.textContent = text;
      bannerBox.hidden = false;
      copy.hidden = false;
      note.textContent = '';
    };

    // Up to five screenshots, each with its own Remove; "choose" goes once five are attached.
    const renderDrop = () => {
      drop.replaceChildren();
      if (draft.shots.length) {
        drop.append(el('div', { class: 'prova-shots', 'data-prova-shots': String(draft.shots.length) }, ...draft.shots.map((shot, i) => el('div', { class: 'prova-shot', 'data-prova-shot': String(i) },
          el('img', { class: 'prova-thumb', src: thumbOf(shot), alt: `Screenshot ${i + 1} to send` }),
          el('span', { text: `${shot.name || 'screenshot'} · ${kb(shot.size)}`, title: shot.name || 'screenshot' }),
          el('button', {
            type: 'button', class: 'prova-rm', 'aria-label': `Remove screenshot ${i + 1}`, 'data-prova-remove': String(i),
            onclick: () => { dropThumb(shot); draft.shots = draft.shots.filter((x) => x !== shot); shotNote.hidden = true; renderDrop(); },
          }, '×')))));
      } else {
        drop.append(el('span', { class: 'prova-thumb', 'aria-hidden': 'true' }), el('span', { text: `Screenshots (optional, up to ${SCREENSHOTS_MAX})` }));
      }
      drop.append(draft.shots.length < SCREENSHOTS_MAX
        ? el('span', { class: 'prova-pick' }, 'Paste, drop or ', el('button', { type: 'button', class: 'prova-link', 'data-prova-choose': '', onclick: () => fileInput.click() }, 'choose'))
        : el('span', { class: 'prova-pick prova-m', 'data-prova-full': '', text: `${SCREENSHOTS_MAX} attached, the most that can be sent` }));
    };
    const takeFiles = async (list) => {
      shotNote.hidden = true;
      const files = [...(list ?? [])].filter(Boolean);
      const notes = files.some((file) => !file.type.startsWith('image/')) ? ['Only images can be attached.'] : [];
      const fitted = await Promise.all(files.filter((file) => file.type.startsWith('image/')).map(async (file) => {
        const fit = await fitScreenshot(file).catch((err) => { console.warn('prova report: the screenshot could not be scaled', err); return null; });
        if (!fit) notes.push(`${file.name || 'The screenshot'} is ${kb(file.size)}; each screenshot may be at most 2 MB.`);
        return fit;
      }));
      if (!dlg.isConnected) return;
      const added = addScreenshots(draft.shots, fitted.filter(Boolean));
      draft.shots = added.shots;
      const said = [...new Set([...notes, ...added.notes])];
      if (said.length) { shotNote.textContent = said.join(' '); shotNote.hidden = false; }
      renderDrop();
    };
    fileInput.addEventListener('change', () => { takeFiles(fileInput.files); fileInput.value = ''; });
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('prova-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('prova-over'));
    drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('prova-over'); takeFiles(event.dataTransfer.files); });
    dlg.addEventListener('paste', (event) => {
      const items = [...(event.clipboardData?.items ?? [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (items.length) { event.preventDefault(); takeFiles(items.map((i) => i.getAsFile())); }
    });
    renderDrop();

    // "This is about" in two steps, filled from the relay's subjects: the app (the default), other apps, "An R
    // package"; choosing a kind shows "Which package" (sorted by name). Hidden while there is only the app itself.
    const aboutSelect = el('select', { name: 'about', 'data-prova-about': '' });
    const subjectSelect = el('select', { name: 'subject', 'data-prova-subject': '', 'aria-describedby': 'prova-subject-note', 'aria-required': 'true' });
    const subjectWhich = el('span', { 'data-prova-subject-label': '', text: 'Which package' });
    const subjectNote = el('p', { id: 'prova-subject-note', class: 'prova-m prova-err', 'data-prova-subject-note': '', 'aria-live': 'polite', hidden: true });
    const subjectRow = el('div', { class: 'prova-chunk-row', 'data-prova-subject-row': '', hidden: true },
      el('label', {}, subjectWhich, subjectSelect), subjectNote);
    const aboutRow = el('div', { class: 'prova-about', 'data-prova-about-row': '', hidden: true },
      el('label', {}, el('span', { text: 'This is about' }), aboutSelect), subjectRow);
    let about = aboutChoices([]);
    // "Mention a chunk": only when the host app offers chunks; nothing of a chunk is sent unless ticked.
    const chunkSelect = el('select', { 'data-prova-chunk': '' });
    const include = el('input', { type: 'checkbox', 'data-prova-chunk-include': '' });
    const chunkPreview = el('div', { class: 'prova-chunk', 'data-prova-chunk-preview': '', hidden: true });
    const chunkRow = el('div', { class: 'prova-chunk-row', 'data-prova-chunk-row': '', hidden: true },
      el('label', {}, el('span', { text: 'Mention a chunk (optional)' }), chunkSelect), chunkPreview);
    let chunkList = [];
    const chosenChunk = () => chunkList.find((c) => c.label === draft.chunk) ?? null;
    const chosenKind = () => (draft.about?.startsWith(GROUP) ? draft.about.slice(GROUP.length) : null);
    // The subject the report is about: the app or another app chosen directly, or the chosen member of a kind.
    const chosenSubject = () => (chosenKind() === null ? draft.about : draft.subject);
    needsPick = () => !aboutRow.hidden && chosenKind() !== null && !draft.subject;
    const subjectLabel = () => {
      const kind = chosenKind();
      if (kind === null) return about.choices.find((c) => c.value === draft.about)?.label ?? null;
      const item = about.groups.get(kind)?.find((x) => x.id === draft.subject);
      return item ? item.label : `${kindWords(kind).option} — none chosen yet`;
    };

    const errorsLine = el('dd', { 'data-prova-errors': '' });
    // A feature request sends no recent errors: they belong to a problem.
    const renderErrors = () => {
      errorsLine.className = draft.kind === 'problem' && tech.errors.length ? 'prova-err' : '';
      errorsLine.replaceChildren(...(draft.kind === 'feature' ? ['not sent with a feature request']
        : tech.errors.length ? [tech.errors.slice(-3).join(' · '), tech.errors.length > 3 ? ` (+${tech.errors.length - 3} more)` : ''] : ['none']));
    };
    const aboutDt = el('dt', { text: 'About', hidden: true });
    const aboutDd = el('dd', { 'data-prova-sent-about': '', hidden: true });
    const chunkDt = el('dt', { text: 'Chunk', hidden: true });
    const chunkDd = el('dd', { 'data-prova-sent-chunk': '', hidden: true });
    const kv = el('dl', { class: 'prova-kv' },
      el('dt', { text: 'You' }), el('dd', { text: opts.user ?? `user of ${opts.app.name}` }),
      el('dt', { text: 'App' }), el('dd', { text: [`${opts.app.name} ${opts.app.version}`.trim(), opts.app.host].filter(Boolean).join(' · ') }),
      aboutDt, aboutDd,
      el('dt', { text: 'Page' }), el('dd', { text: tech.page || '—' }),
      el('dt', { text: 'Browser' }), el('dd', { text: `${tech.browser} · ${tech.os}` }),
      el('dt', { text: 'Recent errors' }), errorsLine,
      chunkDt, chunkDd);
    const sentChunk = el('div', { class: 'prova-sent-chunk', 'data-prova-sent-chunk-text': '', hidden: true });
    const contentNote = el('span', { 'data-prova-content-note': '', text: 'no document content' });
    const details = el('details', { class: 'prova-tech', 'data-prova-sent-with': '' },
      el('summary', {}, 'Sent with it', contentNote), kv, sentChunk);

    // "Sent with it" lists exactly what goes: the subject when one is chosen, and the chunk's text only when ticked.
    const renderSentWith = () => {
      const about = aboutRow.hidden ? null : subjectLabel();
      aboutDt.hidden = about === null; aboutDd.hidden = about === null;
      aboutDd.textContent = about ?? '';
      renderErrors();
      const chunk = draft.kind === 'problem' ? chosenChunk() : null;
      const sending = chunk && draft.includeChunk ? chunkToSend(chunk) : null;
      chunkDt.hidden = chunk === null; chunkDd.hidden = chunk === null;
      chunkDd.textContent = chunk === null ? '' : sending
        ? `${sending.label} · ${sending.engine} — its code and output, below${wasCut(chunk) ? ' (cut to 20,000 characters each)' : ''}`
        : `${chunk.label} — not sent (tick "Include this chunk's code and error" to send it)`;
      sentChunk.replaceChildren(...(sending ? [
        el('pre', { class: 'prova-pre', 'data-prova-sent-code': '', text: sending.code || '(no code)' }),
        el('pre', { class: 'prova-pre prova-out', 'data-prova-sent-output': '', text: sending.output || '(no output)' }),
      ] : []));
      sentChunk.hidden = !sending;
      contentNote.textContent = sending ? 'includes the chunk you ticked' : 'no document content';
    };

    const renderChunk = () => {
      const chunk = chosenChunk();
      include.checked = Boolean(chunk && draft.includeChunk);
      chunkPreview.hidden = chunk === null;
      chunkPreview.replaceChildren(...(chunk ? [
        el('span', { class: 'prova-m', text: `${chunk.label} · ${chunk.engine}` }),
        el('pre', { class: 'prova-pre', 'data-prova-chunk-code': '', text: chunk.code || '(no code)' }),
        el('pre', { class: 'prova-pre prova-out', 'data-prova-chunk-output': '', text: chunk.output || '(no output)' }),
        el('label', { class: 'prova-check' }, include, el('span', { text: "Include this chunk's code and error" })),
      ] : []));
      renderSentWith();
    };
    chunkSelect.addEventListener('change', () => {
      draft.chunk = chunkSelect.value || null;
      draft.includeChunk = false; // a tick was for the chunk shown when it was given
      renderChunk();
    });
    include.addEventListener('change', () => { draft.includeChunk = include.checked; renderSentWith(); });
    // The second step: shown only for a kind, with a placeholder; Send waits (with a note) until one is chosen.
    const renderAbout = () => {
      const kind = chosenKind();
      const items = kind === null ? [] : about.groups.get(kind) ?? [];
      const words = kindWords(kind ?? 'r-package');
      if (!items.some((x) => x.id === draft.subject)) draft.subject = null;
      subjectWhich.textContent = words.which;
      subjectSelect.replaceChildren(el('option', { value: '', text: words.choose, disabled: true }),
        ...items.map((x) => el('option', { value: x.id, text: x.name })));
      subjectSelect.value = draft.subject ?? '';
      subjectRow.hidden = kind === null;
      subjectNote.textContent = needsPick() ? `${words.choose} — the report is sent once one is chosen.` : '';
      subjectNote.hidden = !needsPick();
      sync();
      renderSentWith();
    };
    aboutSelect.addEventListener('change', () => {
      draft.about = aboutSelect.value;
      renderAbout();
      if (chosenKind() !== null) subjectSelect.focus();
    });
    subjectSelect.addEventListener('change', () => { draft.subject = subjectSelect.value || null; renderAbout(); });

    const fillSubjects = (list) => {
      subjectList = Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string' && typeof x.label === 'string') : [];
      about = aboutChoices(subjectList);
      aboutSelect.replaceChildren(...about.choices.map((c) => el('option', { value: c.value, text: c.label })));
      if (!about.choices.some((c) => c.value === draft.about)) draft.about = about.own;
      if (draft.about) aboutSelect.value = draft.about;
      aboutRow.hidden = subjectList.length < 2;
      renderAbout();
    };
    const loadSubjects = async () => {
      if (subjectList) fillSubjects(subjectList);
      if (!opts.subjectsUrl) return;
      try {
        const answer = await call('GET', opts.subjectsUrl);
        if (answer.ok && dlg.isConnected) fillSubjects(answer.json?.subjects);
      } catch (err) {
        console.warn('prova report: the list of subjects could not be loaded; the report is about the app', err);
      }
    };
    const loadChunks = async () => {
      if (typeof opts.chunks !== 'function') return;
      try {
        chunkList = normaliseChunks(await opts.chunks());
      } catch (err) {
        console.warn('prova report: the app could not list its chunks', err);
        chunkList = [];
      }
      if (!dlg.isConnected) return;
      if (!chunkList.some((c) => c.label === draft.chunk)) { draft.chunk = null; draft.includeChunk = false; }
      chunkSelect.replaceChildren(el('option', { value: '', text: 'None' }), ...chunkList.map((c) => el('option', { value: c.label, text: c.label })));
      chunkSelect.value = draft.chunk ?? '';
      chunkRow.hidden = chunkList.length === 0 || draft.kind === 'feature';
      renderChunk();
    };

    const field = (text, input, required = false) => el('label', {}, el('span', { class: required ? 'prova-req' : null, text }), input);
    const whatField = field(KIND_TEXT[draft.kind].what, what, true);
    const expectedField = field(KIND_TEXT[draft.kind].expected, expected);
    const stepsField = field('Steps', steps);
    // Problem or Feature request: one switch, the typed text kept; a request has no steps, chunk or errors.
    const choices = KINDS.map((kind) => el('button', {
      type: 'button', role: 'radio', 'data-prova-kind-choice': kind, text: KIND_TEXT[kind].choice, onclick: () => setKind(kind),
    }));
    const kindSwitch = el('div', { class: 'prova-kind', role: 'radiogroup', 'aria-label': 'What are you sending', 'data-prova-kind': '' }, ...choices);
    kindSwitch.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      setKind(draft.kind === 'problem' ? 'feature' : 'problem');
      choices.find((b) => b.dataset.provaKindChoice === draft.kind).focus();
    });
    const title = header(KIND_TEXT[draft.kind].title);
    function setKind(kind) {
      draft.kind = kind;
      const words = KIND_TEXT[kind];
      title.querySelector('h3').textContent = words.title;
      dlg.setAttribute('aria-label', words.title);
      dlg.dataset.provaKindNow = kind;
      choices.forEach((b) => {
        const on = b.dataset.provaKindChoice === kind;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      whatField.firstChild.textContent = words.what;
      expectedField.firstChild.textContent = words.expected;
      stepsField.hidden = kind === 'feature';
      chunkRow.hidden = chunkList.length === 0 || kind === 'feature';
      if (!busy) send.textContent = dlg.hasAttribute('data-failed') ? 'Send again' : words.send;
      renderSentWith();
    }
    dlg.append(title,
      el('div', { class: 'prova-rows' }, bannerBox, kindSwitch,
        aboutRow, whatField, expectedField, stepsField,
        chunkRow, drop, shotNote, fileInput, details),
      el('footer', {}, note, copy, cancel, send));

    let busy = false;
    const setBusy = (on) => {
      busy = on;
      overlay.toggleAttribute('data-busy', on);
      [what, expected, steps, cancel, aboutSelect, subjectSelect, chunkSelect, include, ...choices].forEach((n) => { n.disabled = on; });
      drop.querySelectorAll('button').forEach((n) => { n.disabled = on; });
      send.disabled = on;
      send.replaceChildren(...(on ? [el('span', { class: 'prova-spin', 'aria-hidden': 'true' }), 'Sending'] : [dlg.hasAttribute('data-failed') ? 'Send again' : KIND_TEXT[draft.kind].send]));
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
      if (needsPick()) { renderAbout(); subjectSelect.focus(); return; }
      bannerBox.hidden = true;
      setBusy(true);
      let answer;
      const kind = draft.kind;
      const problem = kind === 'problem';
      try {
        const body = {
          ...(problem ? {} : { kind }),
          what_happened: draft.what.trim(),
          ...(draft.expected.trim() ? { expected: draft.expected.trim() } : {}),
          ...(problem && draft.steps.trim() ? { steps: draft.steps.trim() } : {}),
          technical: problem ? technical() : { ...technical(), errors: [] },
          ...(draft.shots.length ? {
            screenshots: await Promise.all(draft.shots.map(async (shot) => ({ media_type: shot.type, name: shot.name || 'screenshot', data: await readAsBase64(shot) }))),
          } : {}),
          // The app itself needs no subject; another one is named. A chunk goes only with a problem, when ticked.
          ...(!aboutRow.hidden && chosenSubject() && chosenSubject() !== about.own ? { subject: chosenSubject() } : {}),
          ...(problem && chosenChunk() && draft.includeChunk ? { chunk: chunkToSend(chosenChunk()) } : {}),
        };
        answer = await call('POST', opts.reportUrl, body);
      } catch (err) {
        answer = null;
      }
      if (!overlay) return;
      setBusy(false);
      if (answer?.ok && answer.json?.id) {
        const id = answer.json.id;
        draft.shots.forEach(dropThumb);
        draft.what = ''; draft.expected = ''; draft.steps = ''; draft.shots = [];
        draft.about = null; draft.subject = null; draft.chunk = null; draft.includeChunk = false;
        draft.kind = 'problem';
        showSent(id, kind);
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
    setKind(draft.kind);
    sync();
    loadSubjects();
    loadChunks();
    what.focus();
    return dlg;
  }

  function showSent(id, kind = 'problem') {
    const words = KIND_TEXT[kind] ?? KIND_TEXT.problem;
    const dlg = frame(words.title, { label: `${words.sent} sent` });
    const mineLink = el('button', { type: 'button', class: 'prova-link', 'data-prova-open-mine': '', onclick: () => openMine() }, 'My reports');
    const done = el('button', { type: 'button', class: 'prova-btn prova-primary', 'data-prova-done': '', onclick: close }, 'Done');
    dlg.append(el('div', { class: 'prova-done', role: 'status', 'data-prova-sent': id },
      el('div', { class: 'prova-tick', 'aria-hidden': 'true', text: '✓' }),
      el('h4', { text: 'Sent — thank you' }),
      el('p', {}, `${words.sent} `, el('code', { text: id }), '. Follow it in ', mineLink, '.')),
    el('footer', {}, el('span', { class: 'prova-note' }), done));
    done.focus();
  }

  // A feature request reads in its own words (Planned, Done in 1.6.24, Declined) from Prova's status_label.
  function itemOf(report) {
    const status = STATUS_WORD[report.status] ? report.status : 'received';
    const feature = report.kind === 'feature';
    const label = feature && typeof report.status_label === 'string' && report.status_label ? report.status_label : STATUS_WORD[status];
    const meta = [];
    if (status === 'fixed' && report.fixed_in) meta.push(`${feature ? 'Done' : 'Resolved'} in ${report.fixed_in}`);
    if (status === 'closed' && report.reason) meta.push(report.reason);
    const linked = report.issue ?? report.request ?? null;
    const ids = linked ? `${report.id} → ${linked}` : report.id;
    const unread = Number(report.unread) || 0;
    const questions = Number(report.questions) || 0;
    const count = Number(report.messages) || 0;
    const talk = el('div', { class: 'prova-talk' },
      el('button', { type: 'button', class: 'prova-link', 'data-prova-open-thread': report.id, onclick: () => openThread(report) },
        count ? `${count} message${count === 1 ? '' : 's'} from the team` : 'Write to the team'),
      questions ? el('span', { class: 'prova-q-pill', 'data-prova-question': '', text: questions === 1 ? 'A question for you' : `${questions} questions for you` }) : null,
      unread && !questions ? el('span', { class: 'prova-n', 'data-prova-unread': String(unread), text: `${unread} new` }) : null);
    return el('div', { class: 'prova-item', 'data-prova-item': report.id, 'data-status': status, 'data-kind': feature ? 'feature' : 'problem' },
      el('span', { class: `prova-pill prova-p-${status}`, text: feature && status === 'fixed' ? 'Done' : label }),
      el('div', {}, el('div', { class: 'prova-t' }, feature ? el('span', { class: 'prova-tag', text: 'Request' }) : null, report.title),
        status === 'fixed' && report.resolution ? el('p', { class: 'prova-res', 'data-prova-resolution': '', text: report.resolution }) : null,
        el('div', { class: 'prova-m' }, meta.length ? `${meta.join(' · ')} · ` : '', el('span', { class: 'prova-id', text: ids }),
          report.count > 1 ? ` · seen ${report.count} times` : ''), talk),
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

  // 1.4.0: one report's conversation. The team's messages and questions, the person's own answers; a question
  // offers its answer buttons; one box writes back. Opening it marks the team's messages read (seen=1).
  const threadUrl = (id) => opts.messagesUrl.replace('{id}', encodeURIComponent(id));
  async function openThread(report) {
    clearTimeout(retryTimer);
    const back = el('button', { type: 'button', class: 'prova-btn prova-new', 'data-prova-back': '', onclick: () => openMine() }, 'My reports');
    const dlg = frame('Conversation', { label: `Conversation about ${report.id}`, mine: true });
    dlg.setAttribute('data-prova-dialog', 'thread');
    const list = el('ol', { class: 'prova-thread', 'data-prova-thread': report.id, 'aria-live': 'polite' }, el('li', { class: 'prova-empty', text: 'Loading…' }));
    dlg.append(header('Conversation', back),
      el('p', { class: 'prova-about-thread' }, el('span', { class: 'prova-t', text: report.title }), ' · ', el('span', { class: 'prova-id', text: report.id })), list);
    dlg.focus();
    let answer = null;
    try {
      answer = await call('GET', `${threadUrl(report.id)}?seen=1`);
    } catch (err) {
      answer = null;
    }
    if (!overlay || !list.isConnected) return;
    if (!answer?.ok) {
      list.replaceChildren(el('li', { class: 'prova-banner prova-bad', role: 'alert' }, 'Could not load the conversation. ',
        el('button', { type: 'button', class: 'prova-link', onclick: () => openThread(report) }, 'Try again')));
      return;
    }
    const messages = Array.isArray(answer.json?.messages) ? answer.json.messages : [];
    const canReply = answer.json?.can_reply === true;
    const send = async (body, replyTo, button, note) => {
      button.disabled = true;
      note.hidden = true;
      let posted = null;
      try {
        posted = await call('POST', threadUrl(report.id), { body, ...(replyTo ? { reply_to: replyTo } : {}) });
      } catch (err) {
        posted = null;
      }
      if (!overlay) return;
      if (posted?.ok) { openThread({ ...report, unread: 0 }); refresh(); return; }
      button.disabled = false;
      note.textContent = posted?.json?.error ?? 'Could not send. Your text is kept; try again.';
      note.hidden = false;
    };
    const item = (m) => {
      const you = m.from === 'you';
      const node = el('li', { class: `prova-msg${you ? ' prova-you' : ''}${m.kind === 'question' ? ' prova-q' : ''}`, 'data-prova-msg': String(m.id), 'data-from': m.from, 'data-kind': m.kind },
        el('div', {}, el('span', { class: 'prova-who', text: you ? 'You' : `${m.author}${m.agent ? ' (agent)' : ''}${m.kind === 'question' ? ' asks' : ''}` }),
          el('span', { class: 'prova-when', text: when(m.at) })),
        el('p', { text: m.body }));
      if (m.kind === 'question' && !m.open) node.append(el('p', { class: 'prova-m', text: 'Answered' }));
      if (m.kind === 'question' && m.open && canReply) {
        const note = el('p', { class: 'prova-m prova-err', role: 'status', hidden: true });
        const choices = (Array.isArray(m.options) ? m.options : []).map((option) => el('button', {
          type: 'button', class: 'prova-btn', 'data-prova-choice': option, text: option,
          onclick: (event) => send(option, m.id, event.currentTarget, note),
        }));
        const box = el('textarea', { class: 'prova-small', 'aria-label': 'Your answer', maxlength: String(MESSAGE_MAX), 'data-prova-answer': String(m.id) });
        const go = el('button', { type: 'button', class: 'prova-btn prova-primary', 'data-prova-send-answer': String(m.id), text: 'Answer' });
        go.addEventListener('click', () => { if (box.value.trim()) send(box.value.trim(), m.id, go, note); });
        node.append(...(choices.length ? [el('div', { class: 'prova-choices' }, ...choices)] : []), box, el('div', { class: 'prova-choices' }, go), note);
      }
      return node;
    };
    list.replaceChildren(...(messages.length ? messages.map(item)
      : [el('li', { class: 'prova-empty', 'data-prova-no-messages': '', text: 'Nothing written yet. The team writes here when they need something from you.' })]));
    if (canReply) {
      const box = el('textarea', { class: 'prova-small', 'aria-label': 'Write to the team', placeholder: 'Write to the team…', maxlength: String(MESSAGE_MAX), 'data-prova-reply': '' });
      const go = el('button', { type: 'button', class: 'prova-btn prova-primary', 'data-prova-send-reply': '', text: 'Send', disabled: true });
      const note = el('p', { class: 'prova-m prova-err', role: 'status', hidden: true });
      box.addEventListener('input', () => { go.disabled = box.value.trim().length === 0; });
      go.addEventListener('click', () => { if (box.value.trim()) send(box.value.trim(), null, go, note); });
      dlg.append(el('div', { class: 'prova-compose', 'data-prova-compose': '' }, box, el('div', { class: 'prova-choices' }, go), note));
    } else {
      dlg.append(el('p', { class: 'prova-compose prova-m', 'data-prova-cannot-reply': '', text: 'You can write here once the team has received your report.' }));
    }
    refresh();
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
  function bindMenu({ reportRow = null, featureRow = null, mineRow = null, avatar = null, onOpen = null } = {}) {
    unbind();
    const handle = (fn) => (event) => { event.preventDefault(); onOpen?.(); returnFocus = avatar ?? event.currentTarget; fn(); };
    const listeners = [
      [reportRow, handle(() => openReport({ kind: 'problem' }))],
      [featureRow, handle(() => openReport({ kind: 'feature' }))],
      [mineRow, handle(() => openMine())],
    ].filter(([node]) => node);
    listeners.forEach(([node, fn]) => node.addEventListener('click', fn));
    bound = { reportRow, featureRow, mineRow, avatar, listeners };
    setNews(news);
    return refresh();
  }

  return {
    open: ({ kind = null } = {}) => openReport({ kind }),
    openMine,
    openThread,
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
