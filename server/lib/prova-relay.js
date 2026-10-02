// VENDORED from Prova (prova.lacarm.com/widget/relay.mjs, RELAY_VERSION below). Do not edit here: change it
// in the Prova repo (server/widget/relay.mjs) and copy it again.
// Prova "Report a problem" RELAY (plan 18) — the server half every app vendors beside widget/report.js.
// Zero dependencies, Node >= 18 (global fetch). Served at /widget/relay.mjs so an app can copy it.
//
// The browser never talks to Prova. The app's own server mounts two routes and calls this module:
//   POST <app>/api/report        → relay.report(body, { user })      (user = the app's VERIFIED login, or null)
//   GET  <app>/api/reports/mine  → relay.mine({ user, seen })
// The relay checks the browser's body (allow-list, no document content), adds the stated user and the app
// (name, version, host), and forwards with the installation key. The key never reaches the browser: it is
// configured (`installationKey`, for installations we run) or registered on first start and kept in
// `keyFile` (mode 0600).
import fs from 'node:fs';
import path from 'node:path';

export const RELAY_VERSION = '1.0.0';
export const MAX_BODY = 3 * 1024 * 1024 + 512 * 1024;
const CONTENT_KEYS = ['content', 'source', 'text', 'body', 'cells', 'chunks', 'markdown'];
const BROWSER_FIELDS = { what_happened: 'string', expected: 'string', steps: 'string', technical: 'object', screenshot: 'object' };
const TECHNICAL_FIELDS = ['page', 'browser', 'os', 'errors'];
const SCREENSHOT_FIELDS = ['media_type', 'name', 'data'];

export class RelayError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  toJSON() {
    return { error: this.message, code: this.code, ...this.extra };
  }
}

const refuse = (code, message) => new RelayError(400, code, message);

function contentKey(value, where, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 6) return null;
  for (const [key, item] of Object.entries(value)) {
    const at = Array.isArray(value) ? `${where}[${key}]` : `${where}.${key}`;
    if (!Array.isArray(value) && CONTENT_KEYS.includes(key.toLowerCase())) return at;
    const nested = contentKey(item, at, depth + 1);
    if (nested) return nested;
  }
  return null;
}

const onlyKeys = (value, field, allowed) => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw refuse('unknown_field', `\`${field}\` does not take ${unknown.join(', ')}.`);
};

// What the browser may send. Anything else — a document's text above all — is refused here, before
// it leaves the app's server. Prova checks the same again.
export function checkBrowserReport(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw refuse('invalid_json', 'The report must be a JSON object.');
  const content = contentKey(body, 'report');
  if (content) throw refuse('document_content_refused', `\`${content}\` looks like document content, which a report never carries.`);
  onlyKeys(body, 'report', Object.keys(BROWSER_FIELDS));
  Object.entries(BROWSER_FIELDS).forEach(([key, type]) => {
    if (body[key] === undefined || body[key] === null) return;
    const ok = type === 'object' ? typeof body[key] === 'object' && !Array.isArray(body[key]) : typeof body[key] === type;
    if (!ok) throw refuse('invalid_field', `\`${key}\` must be ${type === 'object' ? 'an object' : 'text'}.`);
  });
  if (typeof body.what_happened !== 'string' || body.what_happened.trim().length < 10) {
    throw refuse('text_too_short', 'Describe what happened in at least 10 characters.');
  }
  const technical = body.technical ?? {};
  onlyKeys(technical, 'technical', TECHNICAL_FIELDS);
  if (technical.errors !== undefined && (!Array.isArray(technical.errors) || technical.errors.some((e) => typeof e !== 'string'))) {
    throw refuse('invalid_field', '`technical.errors` must be a list of strings.');
  }
  if (body.screenshot) onlyKeys(body.screenshot, 'screenshot', SCREENSHOT_FIELDS);
  return {
    what_happened: body.what_happened,
    ...(body.expected ? { expected: body.expected } : {}),
    ...(body.steps ? { steps: body.steps } : {}),
    technical: {
      page: typeof technical.page === 'string' ? technical.page : '',
      browser: typeof technical.browser === 'string' ? technical.browser : '',
      os: typeof technical.os === 'string' ? technical.os : '',
      errors: technical.errors ?? [],
    },
    ...(body.screenshot ? { screenshot: body.screenshot } : {}),
  };
}

function readKeyFile(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof saved.key === 'string' ? saved : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new RelayError(500, 'report_key_unreadable', `The installation key file ${file} cannot be read (${err.message}); delete it to register again.`);
  }
}

function writeKeyFile(file, saved) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

// options: { provaUrl, product, app: { name, version, build?, host }, kind, installationKey?, keyFile?,
//            fetch?, timeoutMs?, log? }
export function createRelay(options) {
  const opts = { timeoutMs: 15000, kind: 'server', fetch: (...args) => globalThis.fetch(...args), log: () => {}, ...options };
  if (!opts.provaUrl) throw new Error('createRelay needs provaUrl');
  if (!opts.product) throw new Error('createRelay needs product');
  if (!opts.installationKey && !opts.keyFile) throw new Error('createRelay needs installationKey or keyFile');
  const base = opts.provaUrl.replace(/\/+$/, '');
  let pending = null;

  const send = async (method, pathname, { body, key } = {}) => {
    const headers = { Accept: 'application/json' };
    if (key) headers['X-Prova-Installation'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await opts.fetch(`${base}/api/v1${pathname}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs), redirect: 'error',
      });
    } catch (err) {
      opts.log('warn', `report relay: Prova at ${base} is unreachable: ${err.message}`);
      throw new RelayError(502, 'report_service_unreachable', 'Could not reach the report service.');
    }
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
    if (json === null && response.status >= 500) {
      throw new RelayError(502, 'report_service_unreachable', 'Could not reach the report service.');
    }
    return { status: response.status, json: json ?? { error: `The report service answered ${response.status}.`, code: 'report_service_error' } };
  };

  const register = async () => {
    const answer = await send('POST', '/intake/installations', {
      body: { product: opts.product, label: opts.app.name, host: opts.app.host ?? '', kind: opts.kind, ...(opts.app.version ? { version: opts.app.version } : {}) },
    });
    if (answer.status !== 201 || !answer.json?.key) {
      throw new RelayError(answer.status === 429 ? 429 : 502, answer.json?.code ?? 'report_registration_failed',
        `This installation could not register with the report service: ${answer.json?.error ?? answer.status}`, answer.json?.retry_after ? { retry_after: answer.json.retry_after } : {});
    }
    writeKeyFile(opts.keyFile, { key: answer.json.key, installation: answer.json.installation.id, prova: base, registered_at: new Date().toISOString() });
    opts.log('info', `report relay: registered installation ${answer.json.installation.id} with ${base} (state ${answer.json.installation.state})`);
    return answer.json.key;
  };

  // The configured key wins; otherwise the saved one; otherwise register once (concurrent callers share it).
  const key = async ({ fresh = false } = {}) => {
    if (opts.installationKey) return opts.installationKey;
    if (!fresh) {
      const saved = readKeyFile(opts.keyFile);
      if (saved && (!saved.prova || saved.prova === base)) return saved.key;
    }
    pending ??= register().finally(() => { pending = null; });
    return pending;
  };

  // A key Prova no longer knows (its database was replaced) is registered again, once; a blocked one is not.
  const withKey = async (fn) => {
    const first = await fn(await key());
    if (first.status === 401 && first.json?.code === 'installation_unknown' && !opts.installationKey) return fn(await key({ fresh: true }));
    return first;
  };

  return {
    ensureKey: () => key(),
    hasKey: () => Boolean(opts.installationKey || readKeyFile(opts.keyFile)),
    async report(browserBody, { user = null } = {}) {
      const checked = checkBrowserReport(browserBody);
      const body = {
        ...checked,
        reporter: user ? { user: String(user).slice(0, 64) } : {},
        technical: { app: { name: opts.app.name, version: opts.app.version, ...(opts.app.build ? { build: opts.app.build } : {}), host: opts.app.host ?? '' }, ...checked.technical },
      };
      return withKey((k) => send('POST', '/intake/reports', { key: k, body }));
    },
    async mine({ user = null, seen = false } = {}) {
      const query = new URLSearchParams();
      if (user) query.set('user', String(user).slice(0, 64));
      if (seen) query.set('seen', '1');
      const qs = query.toString();
      return withKey((k) => send('GET', `/intake/reports${qs ? `?${qs}` : ''}`, { key: k }));
    },
  };
}
