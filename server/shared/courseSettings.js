// Course (cohort) settings keys that carry a contract: whether the optional
// learning measures (Oyon) may run for this course's learners, and an optional
// agreement text the course shows to its learners.
//
// Owner decision 2026-10-25: sensing is controlled per COURSE by the teacher,
// not per case. The agreement is purely informational — Rohy shows it, never
// gates on it and never records acceptance; obtaining agreements is the
// teacher's responsibility and may happen outside Rohy.
//
// Lives in server/shared because the course form validates against the same
// limits (the Docker runtime stage copies server/ but not src/).

export const COURSE_AGREEMENT_TITLE_MAX = 200;
// Bytes of UTF-8, not characters: the limit protects the settings column.
export const COURSE_AGREEMENT_BODY_MAX_BYTES = 64 * 1024;

const utf8Bytes = (s) => new TextEncoder().encode(s).length;

/**
 * Validate and normalise the contract keys of a course settings object.
 * Other keys pass through untouched (settings is a whole-object replace).
 *
 * @param {object} settings  a plain object (the caller has checked that)
 * @returns {{ ok: true, settings: object } | { ok: false, error: string }}
 */
export function validateCourseSettings(settings) {
    const out = { ...settings };
    if ('oyon_sensing_enabled' in out && typeof out.oyon_sensing_enabled !== 'boolean') {
        return { ok: false, error: 'settings.oyon_sensing_enabled must be a boolean' };
    }
    if ('agreement' in out) {
        const a = out.agreement;
        if (a === null) return { ok: true, settings: out };
        if (typeof a !== 'object' || Array.isArray(a)) {
            return { ok: false, error: 'settings.agreement must be null or an object { title, body }' };
        }
        if (a.title != null && typeof a.title !== 'string') {
            return { ok: false, error: 'settings.agreement.title must be a string' };
        }
        if (typeof a.body !== 'string') {
            return { ok: false, error: 'settings.agreement.body must be a string' };
        }
        const title = (a.title || '').trim();
        const body = a.body.trim();
        if (title.length > COURSE_AGREEMENT_TITLE_MAX) {
            return { ok: false, error: `settings.agreement.title must be at most ${COURSE_AGREEMENT_TITLE_MAX} characters` };
        }
        if (utf8Bytes(body) > COURSE_AGREEMENT_BODY_MAX_BYTES) {
            return { ok: false, error: `settings.agreement.body must be at most ${COURSE_AGREEMENT_BODY_MAX_BYTES / 1024} KB` };
        }
        // An empty body is no agreement: there is nothing to show a learner.
        out.agreement = body ? { title, body } : null;
    }
    return { ok: true, settings: out };
}

/**
 * The learner-safe projection of a course's settings JSON: only the keys a
 * learner is meant to see. Malformed JSON reads as no settings.
 *
 * @param {string|null} raw  the cohorts.settings column
 * @returns {{ oyon_sensing_enabled: boolean, agreement: {title: string, body: string} | null }}
 */
export function learnerCourseSettings(raw) {
    let s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch { s = null; }
    const a = s && typeof s.agreement === 'object' && s.agreement && typeof s.agreement.body === 'string' && s.agreement.body.trim()
        ? { title: typeof s.agreement.title === 'string' ? s.agreement.title : '', body: s.agreement.body }
        : null;
    return { oyon_sensing_enabled: s?.oyon_sensing_enabled === true, agreement: a };
}

/**
 * Merge the course form's Oyon + agreement fields over an existing settings
 * object. PATCH /cohorts/:id REPLACES settings, so the caller passes the whole
 * stored object and every other key rides through untouched.
 *
 * @param {object} base  the course's current settings (may be {})
 * @param {{ sensing: boolean, title: string, body: string }} fields
 * @returns {object} a new settings object
 */
export function applyCourseFields(base, { sensing, title, body }) {
    const out = { ...base };
    const trimmedBody = String(body || '').trim();
    // Absent means off / no agreement, so a key is only written when it says
    // something or was already stored — saving an untouched form leaves the
    // settings object exactly as it was.
    if (sensing || 'oyon_sensing_enabled' in out) out.oyon_sensing_enabled = Boolean(sensing);
    if (trimmedBody) out.agreement = { title: String(title || '').trim(), body: trimmedBody };
    else if ('agreement' in out) out.agreement = null;
    return out;
}

/** UTF-8 size of an agreement body, for the form's limit hint. */
export function agreementBodyBytes(body) {
    return utf8Bytes(String(body || '').trim());
}
