import { EmotionRuntime } from '../core/EmotionRuntime.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';

export function createRohyFerAttachment(options) {
  const {
    getSession,
    getToken,
    apiBaseUrl = '',
    mount,
    consentProvider,
    transport,
    transportOptions = {},
    runtimeOptions = {},
  } = options;

  if (typeof getSession !== 'function') {
    throw new Error('createRohyFerAttachment requires getSession().');
  }

  const runtime = new EmotionRuntime({
    ...runtimeOptions,
    contextProvider: () => normalizeSession(getSession()),
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
      const session = normalizeSession(getSession());
      if (!session.session_id) throw new Error('Cannot attach FER without an active session_id.');
      if (consentProvider && !await consentProvider(session)) {
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

function normalizeSession(session = {}) {
  return {
    session_id: session.session_id ?? session.sessionId ?? null,
    user_id: session.user_id ?? session.userId ?? null,
    case_id: session.case_id ?? session.caseId ?? null,
    tenant_id: session.tenant_id ?? session.tenantId ?? null,
  };
}
