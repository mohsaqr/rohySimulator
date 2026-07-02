import { createOyonAttachment } from '../adapters/oyonAttach.js';
import { createRohyFerAttachment } from '../adapters/rohyAttach.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';
import { FallbackEmotionTransport } from '../transport/FallbackEmotionTransport.js';

// Rohy's addon registry posts to this path. Used ONLY when the `rohy` flag is
// set; generic hosts fall back to HttpEmotionTransport's standard
// `/api/sessions/{session_id}/emotions/batch` route (or their own).
const ROHY_ADDON_ENDPOINT = () => '/api/addons/oyon/emotion-records';

export function createNoopOyonAddon(reason = 'disabled') {
  return {
    id: 'oyon',
    name: 'Oyon Emotion Capture',
    enabled: false,
    available: false,
    reason,
    status: 'disabled',
    getStatus() {
      return { enabled: false, available: false, status: 'disabled', reason };
    },
    async start() {
      return { ok: false, reason };
    },
    async stop() {
      return { ok: true, noop: true };
    },
    pause() {
      return { ok: true, noop: true };
    },
    resume() {
      return { ok: true, noop: true };
    },
    getRuntime() {
      return null;
    },
  };
}

/**
 * createOyonAddon — host-neutral addon for feature-flagged platforms (LMS,
 * analytics products, anything with an addon registry + uptime requirements).
 *
 * Wraps an attachment in a lifecycle object (`start/stop/pause/resume/
 * getStatus`) backed by a fallback transport that queues to IndexedDB during
 * outages and surfaces structured callbacks. When `enabled` is false it returns
 * the inert {@link createNoopOyonAddon} twin so the host can register it
 * unconditionally and flip it with one flag.
 *
 * Generic by default (preserves your context taxonomy). Pass `rohy: true` to
 * select Rohy's defaults: the `/api/addons/oyon/emotion-records` endpoint and
 * the fixed-four-field session normalization. The flag is the only difference —
 * everything else is identical.
 *
 * @param {object} options
 * @param {boolean} options.enabled  — feature flag; false → noop addon
 * @param {boolean} [options.rohy=false]  — opt into Rohy endpoint + session shape
 * @param {() => Record<string, unknown>} [options.getContext]  — identity (alias: getSession)
 * @param {() => Record<string, unknown>} [options.getSession]
 * @param {() => (string|null)} [options.getToken]
 * @param {string} [options.apiBaseUrl]
 * @param {(sessionId: string) => string} [options.endpointForSession]
 * @param {number} [options.maxSaveFailures=3]
 * @param {boolean} [options.retryOnce=false]
 * @param {Function} [options.attachmentFactory]  — override the attach factory
 * @param {Function} [options.fetchImpl]
 * @param {string} [options.disabledReason]
 * @param {Function} [options.onUnavailable] [options.onError] [options.onStatus]
 * @param {Function} [options.onWindow] [options.onDrop] [options.onRecovered] [options.mount]
 */
export function createOyonAddon(options = {}) {
  if (!options.enabled) {
    return createNoopOyonAddon(options.disabledReason || 'disabled');
  }

  const rohy = options.rohy === true;
  const variant = rohy ? 'rohy' : 'oyon';

  let status = 'idle';
  let available = true;
  let lastError = null;
  let attachment = null;

  const notifyUnavailable = (error) => {
    available = false;
    lastError = error;
    status = 'unavailable';
    options.onUnavailable?.(error);
  };

  const httpOptions = {
    baseUrl: options.apiBaseUrl || '',
    // Generic hosts: undefined → HttpEmotionTransport's standard route.
    // Rohy: its addon endpoint. Explicit option always wins.
    endpointForSession: options.endpointForSession || (rohy ? ROHY_ADDON_ENDPOINT : undefined),
    tokenProvider: options.getToken || (() => null),
  };
  if (options.fetchImpl) httpOptions.fetchImpl = options.fetchImpl;

  const fallbackTransport = options.transport || new FallbackEmotionTransport({
    transport: new HttpEmotionTransport(httpOptions),
    maxFailures: Number.isInteger(options.maxSaveFailures) ? options.maxSaveFailures : 3,
    retryOnce: options.retryOnce === true,
    onDrop: options.onDrop,
    onDisabled: ({ error }) => {
      notifyUnavailable(error);
      safeDetach(attachment);
    },
    onRecovered: () => {
      available = true;
      lastError = null;
      if (status === 'unavailable') status = 'idle';
      options.onRecovered?.();
    },
  });

  const createAttachment =
    options.attachmentFactory || (rohy ? createRohyFerAttachment : createOyonAttachment);

  function ensureAttachment() {
    if (attachment) return attachment;
    attachment = createAttachment({
      // Pass both — createOyonAttachment reads getContext||getSession;
      // createRohyFerAttachment reads getSession.
      getContext: options.getContext,
      getSession: options.getSession,
      getToken: options.getToken,
      apiBaseUrl: options.apiBaseUrl,
      consentProvider: options.consentProvider,
      transport: fallbackTransport,
      runtimeOptions: options.runtimeOptions,
      mount: (runtime) => {
        runtime.on?.('status', (payload) => {
          status = payload?.state || status;
          options.onStatus?.(payload);
        });
        runtime.on?.('error', (error) => {
          lastError = error;
          options.onError?.(error);
        });
        runtime.on?.('window', (events) => options.onWindow?.(events));
        options.mount?.(runtime);
      },
    });
    return attachment;
  }

  return {
    id: 'oyon',
    name: 'Oyon Emotion Capture',
    variant,
    enabled: true,
    get available() {
      return available;
    },
    get status() {
      return status;
    },
    get lastError() {
      return lastError;
    },
    getStatus() {
      return {
        enabled: true,
        available,
        status,
        variant,
        error: lastError?.message || null,
      };
    },
    async start() {
      if (!available) {
        return { ok: false, reason: 'unavailable', error: lastError };
      }
      try {
        status = 'starting';
        const runtime = await ensureAttachment().attach();
        return { ok: true, runtime };
      } catch (error) {
        notifyUnavailable(error);
        await safeDetach(attachment);
        return { ok: false, reason: 'start-failed', error };
      }
    },
    async stop() {
      try {
        await safeDetach(attachment);
        status = 'stopped';
        return { ok: true };
      } catch (error) {
        lastError = error;
        options.onError?.(error);
        return { ok: false, error };
      }
    },
    pause() {
      try {
        ensureAttachment().runtime?.pause();
        status = 'paused';
        return { ok: true };
      } catch (error) {
        lastError = error;
        options.onError?.(error);
        return { ok: false, error };
      }
    },
    resume() {
      try {
        ensureAttachment().runtime?.resume();
        status = 'running';
        return { ok: true };
      } catch (error) {
        lastError = error;
        options.onError?.(error);
        return { ok: false, error };
      }
    },
    getRuntime() {
      return attachment?.runtime || null;
    },
  };
}

async function safeDetach(attachment) {
  try {
    await attachment?.detach?.();
  } catch {
    // Detach is best-effort in fallback mode. The host must not fail because
    // Oyon cleanup failed.
  }
}
