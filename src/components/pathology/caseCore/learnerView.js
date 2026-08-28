import { cloneCanonical } from './canonicalJson.js';

/** Keys that disclose protected guidance, expected answers, or ROI geometry. */
export const PROTECTED_KEYS = Object.freeze(new Set([
    'answerKey', 'rubric', 'rubricId', 'diagnosis', 'expected', 'accept',
    'requireTerms', 'rejectTerms', 'hints', 'slideCriteria', 'tissueBounds',
    'roi', 'rois', 'minObjective', 'dwellMs', 'critical',
]));

function stripProtected(value) {
    if (Array.isArray(value)) return value.map(stripProtected);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !PROTECTED_KEYS.has(key))
        .map(([key, entry]) => [key, stripProtected(entry)]));
}

/**
 * Defense-in-depth learner projection.
 *
 * A canonical manifest is already public, but extensions and migrated host
 * fields are not trusted. Protected key names are removed recursively.
 */
export function createLearnerManifest(manifest) {
    return cloneCanonical(stripProtected(manifest));
}

/** Find accidental protected fields before a document crosses the boundary. */
export function findLearnerLeaks(value) {
    const leaks = [];
    const walk = (entry, path) => {
        if (Array.isArray(entry)) { entry.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
        if (!entry || typeof entry !== 'object') return;
        Object.entries(entry).forEach(([key, child]) => {
            const childPath = `${path}.${key}`;
            if (PROTECTED_KEYS.has(key)) leaks.push({ path: childPath, key });
            walk(child, childPath);
        });
    };
    try { walk(value, '$'); } catch (error) { return [{ path: '$', key: null, error: error?.message ?? String(error) }]; }
    return leaks;
}

/** Raise if a learner-facing payload contains any protected field. */
export function assertLearnerSafe(value) {
    const leaks = findLearnerLeaks(value);
    if (leaks.length > 0) {
        throw new Error(`Learner payload contains protected fields: ${leaks.map((entry) => entry.path).join(', ')}`);
    }
    return value;
}

