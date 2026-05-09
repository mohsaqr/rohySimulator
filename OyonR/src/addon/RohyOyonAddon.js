import { createRohyFerAttachment } from '../adapters/rohyAttach.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';
import { FallbackEmotionTransport } from '../transport/FallbackEmotionTransport.js';

const DEFAULT_ADDON_ENDPOINT = () => '/api/addons/oyon/emotion-records';

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

export function createRohyOyonAddon(options = {}) {
  if (!options.enabled) {
    return createNoopOyonAddon(options.disabledReason || 'disabled');
  }

  let status = 'idle';
  let available = true;
  let lastError = null;
  let attachment = null;

  const notifyUnavailable = error => {
    available = false;
    lastError = error;
    status = 'unavailable';
    options.onUnavailable?.(error);
  };

  const httpOptions = {
    baseUrl: options.apiBaseUrl || '',
    endpointForSession: options.endpointForSession || DEFAULT_ADDON_ENDPOINT,
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

  const createAttachment = options.attachmentFactory || createRohyFerAttachment;

  function ensureAttachment() {
    if (attachment) return attachment;
    attachment = createAttachment({
      getSession: options.getSession,
      getToken: options.getToken,
      apiBaseUrl: options.apiBaseUrl,
      consentProvider: options.consentProvider,
      transport: fallbackTransport,
      runtimeOptions: options.runtimeOptions,
      mount: runtime => {
        runtime.on?.('status', payload => {
          status = payload?.state || status;
          options.onStatus?.(payload);
        });
        runtime.on?.('error', error => {
          lastError = error;
          options.onError?.(error);
        });
        runtime.on?.('window', events => options.onWindow?.(events));
        options.mount?.(runtime);
      },
    });
    return attachment;
  }

  return {
    id: 'oyon',
    name: 'Oyon Emotion Capture',
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
    // Detach is best-effort in fallback mode. Rohy must not fail because Oyon cleanup failed.
  }
}
