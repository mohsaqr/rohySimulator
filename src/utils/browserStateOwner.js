// Per-person browser state belongs to the person who wrote it.
//
// Logout clears the per-user blobs (AuthContext.logout), but a sign-in that
// simply EXPIRED — a closed browser, a JWT past its lifetime on a shared lab
// PC — never calls logout. The next person who signs in on that browser then
// inherited the previous person's restorable session and chat, their
// learner-report drafts and, worst, their Oyon camera consent flag
// (security audit 2026-10-26, L5-07 / L5-03).
//
// adoptBrowserStateFor(userId) runs at sign-in, BEFORE the new identity is
// announced: rohy_tab_identity still names whoever this browser was signed in
// as last. If that was a different person, their state is purged exactly as
// logout would have purged it. Same person (or nobody recorded): nothing
// changes, so a returning user keeps their restorable session.

import { STORAGE_REGISTRY } from '../storage/registry.js';

// Keys the logout path clears, plus the ones it does not reach.
export const PER_USER_KEYS = Object.freeze([
    'rohy_active_session',
    'rohy_chat_history',
    'rohy_view',
    'rohy_scenario_anchor',
    'rohy_session_pause',
    'rohy_editing_case',
    // Oyon consent mirror and its version (OyonCaptureWidget CONSENT_PREF_KEY,
    // utils/oyonConsent OYON_CONSENT_VERSION_LS_KEY): consent is the person's.
    'oyon.defaultConsent',
    'oyon.consentVersion',
]);

const builderPrefix = (entry) => entry.keyBuilder('').replace(/:+$/, ':');

/** Key prefixes whose every key is one person's (session-scoped drafts and transcripts). */
export function perUserKeyPrefixes() {
    return [
        builderPrefix(STORAGE_REGISTRY.rohy_discussion_history),
        // rohy_plugin:<pluginId>:<sessionId>:<name> — learner report drafts.
        STORAGE_REGISTRY.rohy_plugin.keyBuilder('', '', '').replace(/:+$/, ':'),
    ];
}

function defaultStorage() {
    try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * Remove every per-person key from `storage`.
 *
 * @param {Storage} [storage=localStorage]
 * @returns {string[]} the keys removed
 */
export function purgePerUserBrowserState(storage = defaultStorage()) {
    if (!storage) return [];
    const prefixes = perUserKeyPrefixes();
    try {
        // Storage.key(i), collected first: removing while indexing shifts keys.
        const all = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => typeof k === 'string');
        const doomed = all.filter((k) => PER_USER_KEYS.includes(k) || prefixes.some((p) => k.startsWith(p)));
        doomed.forEach((k) => storage.removeItem(k));
        return doomed;
    } catch {
        return [];
    }
}

/**
 * The user id this browser last announced (services/tabIdentity), or null.
 *
 * @param {Storage} [storage=localStorage]
 * @returns {string|null}
 */
export function previousBrowserUserId(storage = defaultStorage()) {
    if (!storage) return null;
    try {
        const parsed = JSON.parse(storage.getItem('rohy_tab_identity') || 'null');
        const id = parsed && typeof parsed === 'object' ? parsed.userId : null;
        return id === null || id === undefined ? null : String(id);
    } catch {
        return null;
    }
}

/**
 * Call at sign-in, before announceIdentity(user). Purges the previous
 * person's state when this browser was last signed in as someone else.
 *
 * @param {string|number|null|undefined} userId  the person signing in
 * @param {Storage} [storage=localStorage]
 * @returns {boolean} true when another person's state was purged
 */
export function adoptBrowserStateFor(userId, storage = defaultStorage()) {
    if (userId === null || userId === undefined) return false;
    const previous = previousBrowserUserId(storage);
    if (previous === null || previous === String(userId)) return false;
    purgePerUserBrowserState(storage);
    return true;
}
