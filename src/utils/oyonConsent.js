// Oyon consent versioning (migration 0041).
//
// Consent used to be a bare boolean, so nothing recorded WHICH contract a
// learner agreed to. That made a version bump unsafe: it would have silently
// re-labelled every existing consent as covering data the learner was never
// asked about. These helpers are the client half of the fix — the server half
// is `consentCoversModality()` in server/routes/oyon-routes.js, which is the
// authority. Nothing here is a security boundary; the server re-checks.
//
// Rule everywhere: an ACCEPTED version is what the learner was actually shown.
// Never what the tenant currently advertises.

/**
 * Fired on `window` after a consent choice has been SAVED (the preferences PUT
 * settled), by every surface that records one. Anything that read consent at
 * mount re-reads it on this event. Without it a learner who accepted the
 * consent prompt got no typing or voice capture until a reload — which, since
 * every new learner meets that prompt, was every new learner's first session
 * (Prova PRV-5).
 */
export const OYON_CONSENT_CHANGED_EVENT = 'rohy:oyon-consent-changed';

/** Tell mounted readers that the recorded consent changed. */
export function announceOyonConsentChanged() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OYON_CONSENT_CHANGED_EVENT));
}

/** Where this browser mirrors the accepted contract, beside CONSENT_PREF_KEY. */
export const OYON_CONSENT_VERSION_LS_KEY = 'oyon.consentVersion';

/** Ordered contracts, oldest first — index doubles as the version rank. */
export const OYON_CONSENT_VERSIONS = Object.freeze([
    'oyon-consent-v1',
    'oyon-consent-v2',
    'oyon-consent-v3',
]);

/**
 * The first contract that names voice and AI-assistance capture. Must match the
 * server's MODALITY_MIN_CONSENT in server/routes/oyon-routes.js — that is the
 * authority, and it refuses these modalities at ingest below v3.
 */
export const OYON_CONSENT_VOICE = 'oyon-consent-v3';

/**
 * The OLDEST contract that names each host-driven modality. Mirrors
 * MODALITY_MIN_CONSENT in server/routes/oyon-routes.js — the server is the
 * authority and refuses uncovered windows at ingest; this copy exists so the
 * client does not capture what it will only have thrown away.
 */
export const OYON_MODALITY_MIN_CONSENT = Object.freeze({
    typing: 'oyon-consent-v2',
    interaction: 'oyon-consent-v2',
    discourse: 'oyon-consent-v2',
    ai_assist: OYON_CONSENT_VOICE,
    voice: OYON_CONSENT_VOICE,
});

/**
 * The runtime config with every modality the accepted contract does NOT name
 * switched off.
 *
 * Gating per modality, not on the tenant's required version as a whole, is the
 * point: that version is the NEWEST any enabled modality needs, so turning voice
 * on raises it to v3 — and an all-or-nothing gate would then stop typing for
 * every learner holding v2, although v2 names typing and the server would still
 * accept it. A missing accepted version reads as v1, as everywhere else.
 */
export function coveredRuntime(runtime, acceptedVersion) {
    if (!runtime || typeof runtime !== 'object') return runtime;
    const acceptedRank = consentRank(acceptedVersion || OYON_CONSENT_CAMERA_ONLY);
    const out = { ...runtime };
    for (const [modality, version] of Object.entries(OYON_MODALITY_MIN_CONSENT)) {
        const flag = `${modality}_enabled`;
        if (flag in out && acceptedRank < consentRank(version)) out[flag] = false;
    }
    return out;
}

/** The contract that covered camera-derived affect only. */
export const OYON_CONSENT_CAMERA_ONLY = 'oyon-consent-v1';

/**
 * Rank of a consent version; -1 for anything unrecognised.
 * An unrecognised value is deliberately ranked BELOW v1 so an unknown string
 * can never satisfy a staleness check.
 */
export function consentRank(version) {
    return OYON_CONSENT_VERSIONS.indexOf(version);
}

/**
 * Has the learner accepted a contract at least as new as the tenant requires?
 *
 * A missing `accepted` is read as v1 — the only contract that existed before
 * the column did — matching the server's reading of a NULL accepted_version.
 * A `required` the client doesn't recognise (server newer than this bundle)
 * is treated as NOT satisfied, so an out-of-date client re-prompts rather than
 * silently assuming it is current.
 */
export function consentSatisfies(accepted, required) {
    if (!required) return true;
    const requiredRank = consentRank(required);
    if (requiredRank === -1) return false;
    const acceptedRank = consentRank(accepted || OYON_CONSENT_CAMERA_ONLY);
    return acceptedRank >= requiredRank;
}

/**
 * Should the re-consent prompt be shown?
 *
 * Only when the learner previously said YES to an older contract. Someone who
 * declined has already made a choice — re-asking on every load would be
 * nagging, and they can opt in from Settings → Oyon whenever they want. Someone
 * who has never answered has no `granted` flag at all and is handled by the
 * first-run card, so the `granted` check alone keeps them out.
 *
 * ISSUE-0019: a grant carrying NO version used to return false here, which
 * made that state permanent — the gate read the missing version as v1 and
 * refused the signal scope, and this prompt, the only repair path, declined
 * to ask. A stored `granted` is an answer; a missing version means it was
 * given under v1, which is exactly who this prompt exists for. The reading
 * matches consentSatisfies, where a missing accepted version is also v1.
 */
export function needsConsentUpgrade({ granted, acceptedVersion, requiredVersion }) {
    if (!granted) return false;
    return !consentSatisfies(acceptedVersion, requiredVersion);
}

/** What to send as `accepted_version` — only ever a contract we can render. */
export function acceptableVersion(requiredVersion) {
    return consentRank(requiredVersion) === -1 ? OYON_CONSENT_CAMERA_ONLY : requiredVersion;
}
