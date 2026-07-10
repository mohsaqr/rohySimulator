// Visible, language-bearing case identifier (e.g. IT-0042).
//
// The numeric part IS the internal integer id, so codes are unique by
// construction. The prefix is the case's own dialogue language
// (config.case_language), which is IMMUTABLE after creation: POST /cases
// normalizes it to a concrete registry code (junk/absent → default), and
// every later write preserves the stored value — a case's code never
// changes, and switching the UI language never changes how a case behaves.
//
// Lives under server/shared/ (not src/) for the same Docker-image reason
// as languages.js: the runtime stage ships server/ but not src/.

import { DEFAULT_LANGUAGE, isKnownLanguage } from './languages.js';

/**
 * The case's own dialogue language, normalized to a registry code.
 * @param {object|null|undefined} config  Parsed case config JSON.
 * @returns {string} A LANGUAGES key; absent/unknown collapses to the default
 *   language — every case owns one concrete language.
 */
export function normalizeCaseLanguage(config) {
    const lang = config?.case_language;
    return isKnownLanguage(lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * Visible case code for a case row.
 * @param {object|null|undefined} config  Parsed case config JSON.
 * @param {number} id  Internal integer case id.
 * @returns {string} e.g. 'IT-0042' (id padded to at least 4 digits).
 */
export function caseCodeFor(config, id) {
    return `${normalizeCaseLanguage(config).toUpperCase()}-${String(id).padStart(4, '0')}`;
}
