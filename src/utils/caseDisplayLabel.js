// Student-safe case label (Bug 9, 16.5.2026 report).
//
// The authoring title (`cases.name`) routinely contains the diagnosis —
// e.g. "Acute Stroke – Left MCA". Rendering it in the room headers handed
// students the answer before they worked the case. Educators+ author and
// supervise cases, so they still see the real title; everyone at or below
// `reviewer` sees only the patient identity.
//
// Centralised here on purpose: the same rule is needed by every room
// header (Physical Exam, Laboratory, Radiology, Patient Monitor). Per the
// project convention we resolve it in one place rather than repeating the
// `activeCase?.name || ...` chain — which was exactly how the leak spread
// to four screens.

// Mirrors the server rank ladder (server/middleware/auth.js ROLE_RANKS).
// `user` is the legacy alias for `student` rank.
const ROLE_RANKS = Object.freeze({
    guest: 0,
    student: 1,
    user: 1,
    reviewer: 2,
    educator: 3,
    admin: 4,
});

/** Numeric rank for a role string (unknown / missing → guest). */
export function roleRank(role) {
    return ROLE_RANKS[role] ?? 0;
}

/** True when the viewer authors/supervises cases (educator or admin). */
export function canSeeCaseTitle(user) {
    return roleRank(user?.role) >= ROLE_RANKS.educator;
}

/**
 * The header label to show for a case.
 *
 * Accepts either the API case shape (`patient_name` column) or the
 * config-wrapped shape (`config.patient_name`) so every room can pass
 * whatever it already holds.
 *
 * @param {object|null|undefined} activeCase
 * @param {object|null|undefined} user  the viewer (from useAuth)
 * @param {string} [fallback='Patient']
 * @returns {string}
 */
export function caseDisplayLabel(activeCase, user, fallback = 'Patient') {
    const patientName =
        activeCase?.patient_name ||
        activeCase?.config?.patient_name ||
        null;

    if (canSeeCaseTitle(user)) {
        // Authors want to know which case they are observing.
        return activeCase?.name || patientName || fallback;
    }

    // Students / reviewers / guests: NEVER the authoring title — that is
    // the diagnosis leak. Patient identity only.
    return patientName || fallback;
}
