/*
 * filterWindows — pure, dependency-free scope/user/session filtering over
 * stored EmotionWindow records.
 *
 * Plain JS (with a sibling .d.ts) so the root repo's node test chain can
 * execute it directly — same precedent as src/legacy/dashboard.js. Keep this
 * file free of imports and browser APIs.
 *
 * Window records carry `session_id` and `user_id` because
 * EmotionRuntime.sendWindows() spreads the contextProvider output into every
 * event. Records from before identity existed may lack `user_id`; they are
 * grouped under DEFAULT_USER (honest bucket, not dropped).
 */

export const DEFAULT_SESSION = '__default__';
export const DEFAULT_USER = '__unknown__';

/** Session id of a window record (mirrors sessions.ts sessionIdOf). */
export function sessionIdOf(window) {
  if (!window || typeof window !== 'object') return DEFAULT_SESSION;
  const direct = window.session_id;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const ctx = window.context;
  if (ctx && typeof ctx.session_id === 'string' && ctx.session_id.length > 0) {
    return ctx.session_id;
  }
  return DEFAULT_SESSION;
}

/** User id of a window record; DEFAULT_USER when absent. */
export function userIdOf(window) {
  if (!window || typeof window !== 'object') return DEFAULT_USER;
  const direct = window.user_id;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const ctx = window.context;
  if (ctx && typeof ctx.user_id === 'string' && ctx.user_id.length > 0) {
    return ctx.user_id;
  }
  return DEFAULT_USER;
}

/** Distinct user ids across records, insertion-ordered. */
export function distinctUsers(windows) {
  const seen = new Set();
  const out = [];
  for (const w of Array.isArray(windows) ? windows : []) {
    const id = userIdOf(w);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Distinct session ids across records, insertion-ordered. */
export function distinctSessions(windows) {
  const seen = new Set();
  const out = [];
  for (const w of Array.isArray(windows) ? windows : []) {
    const id = sessionIdOf(w);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Filter stored windows by scope, then by optional session/user narrowing.
 *
 * @param {Array<object>} windows
 * @param {object} options
 * @param {'current'|'past'|'all'} [options.scope='all']
 *        'current' keeps only the live capture session; 'past' excludes it;
 *        'all' keeps everything. When `currentSessionId` is null, 'current'
 *        yields [] (nothing is live) and 'past' degrades to everything.
 * @param {string|null} [options.currentSessionId]
 * @param {string[]|null} [options.sessionIds]  null = no narrowing.
 * @param {string[]|null} [options.userIds]     null = no narrowing.
 * @returns {Array<object>}
 */
export function filterWindows(windows, options = {}) {
  const list = Array.isArray(windows) ? windows : [];
  const scope = options.scope === 'current' || options.scope === 'past' ? options.scope : 'all';
  const current = typeof options.currentSessionId === 'string' && options.currentSessionId.length > 0
    ? options.currentSessionId
    : null;
  const sessionIds = Array.isArray(options.sessionIds) && options.sessionIds.length > 0
    ? new Set(options.sessionIds)
    : null;
  const userIds = Array.isArray(options.userIds) && options.userIds.length > 0
    ? new Set(options.userIds)
    : null;

  return list.filter((w) => {
    const session = sessionIdOf(w);
    if (scope === 'current') {
      if (current === null || session !== current) return false;
    } else if (scope === 'past') {
      if (current !== null && session === current) return false;
    }
    if (sessionIds && !sessionIds.has(session)) return false;
    if (userIds && !userIds.has(userIdOf(w))) return false;
    return true;
  });
}
