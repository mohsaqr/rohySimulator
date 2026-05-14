import { EmotionRuntime } from '../core/EmotionRuntime.js';
import { LocalEmotionTransport } from '../transport/LocalEmotionTransport.js';

export function createStandaloneFerAttachment(options = {}) {
  const runtime = new EmotionRuntime({
    ...options.runtimeOptions,
    contextProvider: options.contextProvider || defaultContextProvider,
    transport: options.transport || new LocalEmotionTransport(options.localTransport),
  });

  return {
    runtime,
    async start() {
      if (options.consentProvider && !await options.consentProvider()) return runtime;
      await runtime.start();
      return runtime;
    },
    async stop() {
      await runtime.stop();
    },
    pause() {
      runtime.pause();
    },
    resume() {
      runtime.resume();
    },
  };
}

function defaultContextProvider() {
  return {
    session_id: 'standalone-session',
    user_id: 'standalone-user',
    case_id: 'standalone-case',
    tenant_id: 'standalone',
  };
}
