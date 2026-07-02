import { createOyonAttachment } from './oyonAttach.js';

/**
 * createRohyFerAttachment — Rohy-shaped wrapper over the host-neutral
 * {@link createOyonAttachment}. Kept for back-compat: it normalizes the host
 * session to Rohy's fixed four fields (`session_id`, `user_id`, `case_id`,
 * `tenant_id`) and nothing else.
 *
 * New, non-Rohy hosts (LMS, analytics platforms, anything with its own
 * context taxonomy) should use `createOyonAttachment` directly — it preserves
 * arbitrary context keys instead of dropping them to these four.
 */
export function createRohyFerAttachment(options) {
  if (typeof options?.getSession !== 'function') {
    throw new Error('createRohyFerAttachment requires getSession().');
  }
  return createOyonAttachment({
    ...options,
    getContext: () => normalizeSession(options.getSession()),
  });
}

function normalizeSession(session = {}) {
  return {
    session_id: session.session_id ?? session.sessionId ?? null,
    user_id: session.user_id ?? session.userId ?? null,
    case_id: session.case_id ?? session.caseId ?? null,
    tenant_id: session.tenant_id ?? session.tenantId ?? null,
  };
}
