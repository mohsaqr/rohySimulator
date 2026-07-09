// Single source of truth for every language rohySimulator knows (I18N_PLAN.md §2).
//
// Lives under server/ (not src/) because the Docker runtime stage copies
// server/ wholesale but NOT src/ — server code importing from src/ would
// crash only in the deployed image (the Lab_database.json failure mode).
// Client code imports this via the re-export at src/i18n/languages.js.
//
// Adding a language = adding one entry here + a locales/<code>/ folder
// (+ optional voice catalogue rows / Piper .onnx files). No component,
// route, or service may hardcode a language name or code.
//
// llmDirective: appended server-side to the assembled system prompt
// (server/services/systemPromptAssembly.js). Phrased in English naming the
// target language — reviewable by non-speakers — with a short native-language
// reinforcement. null = model default (English), nothing appended.

export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGES = {
    en: {
        name: 'English',
        native: 'English',
        stt: 'en-US',
        sttLabel: 'English (US)',
        llmDirective: null,
        dir: 'ltr'
    },
    it: {
        name: 'Italian',
        native: 'Italiano',
        stt: 'it-IT',
        sttLabel: 'Italian',
        llmDirective: 'Always respond in Italian (italiano), regardless of the language the student writes in. Rispondi sempre in italiano.',
        dir: 'ltr'
    },
    fi: {
        name: 'Finnish',
        native: 'Suomi',
        stt: 'fi-FI',
        sttLabel: 'Finnish',
        llmDirective: 'Always respond in Finnish (suomi), regardless of the language the student writes in. Vastaa aina suomeksi.',
        dir: 'ltr'
    },
    sv: {
        name: 'Swedish',
        native: 'Svenska',
        stt: 'sv-SE',
        sttLabel: 'Swedish',
        llmDirective: 'Always respond in Swedish (svenska), regardless of the language the student writes in. Svara alltid på svenska.',
        dir: 'ltr'
    },
    de: {
        name: 'German',
        native: 'Deutsch',
        stt: 'de-DE',
        sttLabel: 'German',
        llmDirective: 'Always respond in German (Deutsch), regardless of the language the student writes in. Antworte immer auf Deutsch.',
        dir: 'ltr'
    }
};

// STT-only dialects: speech recognition locales the browser handles that are
// not (yet) full app languages. Preserved from the old hardcoded list in
// VoiceSettingsTab. Promoting one to a full language = moving it into
// LANGUAGES above; it disappears from here automatically via sttOptions().
export const STT_DIALECTS = [
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'tr-TR', label: 'Turkish' },
    { code: 'ar-SA', label: 'Arabic (Saudi)' },
    { code: 'fr-FR', label: 'French' },
    { code: 'es-ES', label: 'Spanish' }
];

export function isKnownLanguage(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

/**
 * Output-language directive for the LLM system prompt.
 * @param {string} code  Registry language code ('en', 'it', …).
 * @returns {string|null} Directive text, or null when the model default
 *   applies (English, unknown, or missing code — never throws on bad input
 *   because the value arrives from a request body).
 */
export function llmDirectiveFor(code) {
    if (!isKnownLanguage(code)) return null;
    return LANGUAGES[code].llmDirective;
}

/**
 * Tidy option list for STT language dropdowns: every registry language's
 * STT locale first (registry order), then the extra dialects, deduped by code.
 * @returns {{code: string, label: string}[]}
 */
export function sttOptions() {
    const fromRegistry = Object.values(LANGUAGES).map(lang => ({
        code: lang.stt,
        label: lang.sttLabel
    }));
    const seen = new Set(fromRegistry.map(opt => opt.code));
    const extras = STT_DIALECTS.filter(opt => !seen.has(opt.code));
    return [...fromRegistry, ...extras];
}

/**
 * BCP-47 STT locale for a registry language, with a safe default.
 * @param {string} code  Registry language code.
 * @returns {string} e.g. 'it-IT'; falls back to the default language's locale.
 */
export function sttLocaleFor(code) {
    const lang = isKnownLanguage(code) ? LANGUAGES[code] : LANGUAGES[DEFAULT_LANGUAGE];
    return lang.stt;
}
