import { EmotionRuntime } from '../core/EmotionRuntime.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';

/**
 * createOyonAttachment — the host-neutral way to attach Oyon to ANY app.
 *
 * This is the generic front door. You provide a `getContext()` callback that
 * returns whatever identity/context your host has (a session id, plus any
 * join keys you want on every window — `user_id`, `course_id`, `activity_id`,
 * `cohort`, …). Those keys ride along on every aggregate window so you can
 * join Oyon's analytics against your own tables.
 *
 * Unlike the Rohy-specific factory, this DOES NOT discard context keys it
 * doesn't recognize — an LMS or analytics platform keeps its own taxonomy.
 * The only requirement is a `session_id` (the transport routes batches by it);
 * `sessionId`/`userId`/`caseId`/`tenantId` are accepted as camelCase aliases.
 *
 * Local-only (no backend): omit `apiBaseUrl`/`getToken` and pass your own
 * `transport` (e.g. LocalEmotionTransport), or consume `runtime.on('window')`
 * and ignore transport entirely.
 *
 * @param {object} options
 * @param {() => Record<string, unknown>} options.getContext  identity/context (alias: getSession)
 * @param {() => (string|null|Promise<string|null>)} [options.getToken]  bearer token provider
 * @param {string} [options.apiBaseUrl='']  base URL for the default HTTP transport
 * @param {(runtime: EmotionRuntime) => void} [options.mount]  called after start()
 * @param {(ctx: object) => (boolean|Promise<boolean>)} [options.consentProvider]  gate before capture
 * @param {object} [options.transport]  override the transport entirely
 * @param {object} [options.transportOptions]  extra HttpEmotionTransport options (e.g. endpointForSession)
 * @param {object} [options.runtimeOptions]  passed through to EmotionRuntime (settings, etc.)
 * @returns {{ runtime: EmotionRuntime, attach: () => Promise<EmotionRuntime>, detach: () => Promise<void> }}
 */
export function createOyonAttachment(options = {}) {
  const {
    getContext,
    getSession, // ergonomic alias — many hosts already have getSession()
    getToken,
    apiBaseUrl = '',
    mount,
    consentProvider,
    transport,
    transportOptions = {},
    runtimeOptions = {},
  } = options;

  const resolveContext = getContext || getSession;
  if (typeof resolveContext !== 'function') {
    throw new Error('createOyonAttachment requires getContext() (or getSession()).');
  }

  const runtime = new EmotionRuntime({
    ...runtimeOptions,
    contextProvider: () => normalizeContext(resolveContext()),
    transport: transport || new HttpEmotionTransport({
      baseUrl: apiBaseUrl,
      tokenProvider: getToken || (() => null),
      ...transportOptions,
    }),
  });

  let attached = false;

  return {
    runtime,
    async attach() {
      if (attached) return runtime;
      const ctx = normalizeContext(resolveContext());
      if (!ctx.session_id) {
        throw new Error(
          'Cannot attach Oyon without a session_id (set session_id or sessionId on your context).',
        );
      }
      if (consentProvider && !(await consentProvider(ctx))) {
        return runtime;
      }
      await runtime.start();
      mount?.(runtime);
      attached = true;
      return runtime;
    },
    async detach() {
      attached = false;
      await runtime.stop();
    },
  };
}

/**
 * Pass-through context normalizer: keeps EVERY key the host supplies and adds
 * snake_case aliases for the common identity fields when only camelCase was
 * given. Never drops a key — your `course_id` / `activity_id` survive intact.
 *
 * @param {Record<string, unknown>} ctx
 * @returns {Record<string, unknown>}
 */
export function normalizeContext(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') return {};
  const out = { ...ctx };
  alias(out, 'session_id', 'sessionId');
  alias(out, 'user_id', 'userId');
  alias(out, 'case_id', 'caseId');
  alias(out, 'tenant_id', 'tenantId');
  return out;
}

function alias(obj, snake, camel) {
  const value = obj[snake] ?? obj[camel];
  if (value !== undefined && value !== null) obj[snake] = value;
}
