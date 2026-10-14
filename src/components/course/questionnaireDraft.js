// A learner's unsent questionnaire answers, kept per tab (sessionStorage) so
// they survive the panel remounting — leaving the course view and coming
// back, a reload, the gate opening. Before, they lived only in component
// state and were lost on any remount (FI-0010 review F14). Keyed by user,
// case, questionnaire and attempt; removed once the attempt is sent.
const PREFIX = 'rohy_questionnaire_draft';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {{userId?: number|null, caseId: number, questionnaireId: string, attempt: string}} parts
 * @returns {string}
 */
export function draftKey({ userId, caseId, questionnaireId, attempt }) {
    return `${PREFIX}:${userId ?? 'anon'}:${caseId}:${questionnaireId}:${attempt}`;
}

/** The stored answers for the key, or {} (nothing stored, storage off, or unreadable). */
export function readDraft(key) {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? parsed : {};
    } catch (err) {
        console.warn('[questionnaire] could not read the draft:', err?.message);
        return {};
    }
}

/** Store the answers (an empty object removes the draft). */
export function writeDraft(key, answers) {
    try {
        if (!isPlainObject(answers) || Object.keys(answers).length === 0) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(answers));
    } catch (err) {
        // Private mode or a full quota: the answers stay on screen, just not across a remount.
        console.warn('[questionnaire] could not keep the draft:', err?.message);
    }
}

export function clearDraft(key) {
    try {
        sessionStorage.removeItem(key);
    } catch (err) {
        console.warn('[questionnaire] could not clear the draft:', err?.message);
    }
}
