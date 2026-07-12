// Student-affect routing (Plan A, todo/plan-a-implementation-spec.md):
// validation of the client's structured affect signal and rendering of the
// transient "observed clinician affect" prompt block.
//
// Lives under server/shared/ for the same reason as languages.js and
// llmCatalogue.js: the Docker runtime stage copies server/ wholesale but NOT
// src/, and the client (DiagnosticBar, A2) will need the identical renderer.
//
// Security contract: the client NEVER sends prompt prose for this feature —
// only a small structured signal. Everything that reaches the LLM is composed
// here from enum-validated fields, so the `student_affect` body field cannot
// be used to inject instructions into the system prompt.

// Deliberate hand-synced mirror of OYON_EMOTION_LABELS in
// src/components/oyon/emotionVocabulary.js — server/shared cannot import from
// src/ (it would crash only in the deployed image). Parity is guarded by
// tests/server/affect-routing.test.js, which imports BOTH and asserts equality.
export const AFFECT_LABELS = Object.freeze([
    'anger',
    'contempt',
    'disgust',
    'fear',
    'happy',
    'neutral',
    'sad',
    'surprise',
]);

// A1 ships `dominant` and `anxious` (the privacy-lightest signal);
// `aggregate` and `trend` arrive in A2 and are rejected until then.
export const AFFECT_MODES = Object.freeze(['off', 'dominant', 'anxious']);

export const AFFECT_PROVIDER_POLICIES = Object.freeze(['local_only', 'any']);

export const AFFECT_REACTIVITIES = Object.freeze(['subtle', 'moderate', 'strong']);

// Platform defaults: OFF, the privacy-lightest mode, local providers only.
// Affect is biometric-derived data — every widening of this default is an
// explicit admin decision (and `providers: 'any'` needs governance sign-off).
export const DEFAULT_AFFECT_ROUTING = Object.freeze({
    enabled: false,
    affect_mode: 'anxious',
    min_confidence: 0.4,
    max_age_ms: 20000,
    reactivity: 'subtle',
    may_acknowledge: false,
    providers: 'local_only',
});

function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Coerce a stored/incoming affect-routing config to a complete, valid
 * settings object. Accepts an object, a JSON string (the platform_settings
 * storage form), or null/garbage — anything invalid falls back per-field to
 * DEFAULT_AFFECT_ROUTING, so callers can trust every field.
 *
 * @param {object|string|null} raw
 * @returns {{enabled: boolean, affect_mode: string, min_confidence: number,
 *   max_age_ms: number, reactivity: string, may_acknowledge: boolean,
 *   providers: string}}
 */
export function normalizeAffectSettings(raw) {
    let cfg = raw;
    if (typeof cfg === 'string') {
        try { cfg = JSON.parse(cfg); } catch { cfg = null; }
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
    const d = DEFAULT_AFFECT_ROUTING;
    const maxAge = Number(cfg.max_age_ms);
    return {
        enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : d.enabled,
        affect_mode: AFFECT_MODES.includes(cfg.affect_mode) ? cfg.affect_mode : d.affect_mode,
        min_confidence: Number.isFinite(Number(cfg.min_confidence))
            ? clamp01(cfg.min_confidence)
            : d.min_confidence,
        max_age_ms: Number.isFinite(maxAge) && maxAge >= 1000 && maxAge <= 120000
            ? Math.round(maxAge)
            : d.max_age_ms,
        reactivity: AFFECT_REACTIVITIES.includes(cfg.reactivity) ? cfg.reactivity : d.reactivity,
        may_acknowledge: typeof cfg.may_acknowledge === 'boolean' ? cfg.may_acknowledge : d.may_acknowledge,
        providers: AFFECT_PROVIDER_POLICIES.includes(cfg.providers) ? cfg.providers : d.providers,
    };
}

/**
 * Validate the untrusted `student_affect` body field into a normalized
 * signal, or null. Strict: unknown modes, non-canonical labels, missing
 * booleans, or non-finite numbers reject the whole signal — a dropped affect
 * note is invisible garnish; a malformed one must never reach the prompt.
 *
 * @param {any} raw client-sent signal
 * @returns {{mode: string, label: string|null, anxious: boolean|null,
 *   confidence: number, age_ms: number}|null}
 */
export function validateAffectSignal(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const mode = raw.mode;
    if (mode !== 'dominant' && mode !== 'anxious') return null;
    const ageMs = Number(raw.age_ms);
    if (!Number.isFinite(ageMs) || ageMs < 0) return null;
    const confidence = clamp01(raw.confidence);
    if (mode === 'dominant') {
        const label = typeof raw.label === 'string' ? raw.label.trim().toLowerCase() : '';
        if (!AFFECT_LABELS.includes(label)) return null;
        return { mode, label, anxious: null, confidence, age_ms: Math.round(ageMs) };
    }
    if (typeof raw.anxious !== 'boolean') return null;
    return { mode, label: null, anxious: raw.anxious, confidence, age_ms: Math.round(ageMs) };
}

// How the 8 canonical labels read in the note. Plain observational adjectives
// — the model gets "the clinician appears X", never an interpretation.
const LABEL_PHRASES = Object.freeze({
    anger: 'irritated or angry',
    contempt: 'dismissive or contemptuous',
    disgust: 'uncomfortable or repulsed',
    fear: 'fearful or anxious',
    happy: 'cheerful and at ease',
    neutral: 'calm and neutral',
    sad: 'sad or downcast',
    surprise: 'surprised',
});

const REACTIVITY_PHRASES = Object.freeze({
    subtle: 'Let this subtly shape how you feel and respond in character.',
    moderate: 'Let this noticeably influence how you feel and respond in character.',
    strong: 'Let this strongly shape how you feel and respond in character.',
});

function confidencePhrase(confidence) {
    if (confidence >= 0.8) return 'high confidence';
    if (confidence >= 0.55) return 'moderate confidence';
    return 'low confidence';
}

/**
 * Render a VALIDATED signal (from validateAffectSignal) into the transient
 * prompt block. Returns '' when the signal carries nothing to say.
 *
 * The fourth-wall line is on unless `may_acknowledge` is explicitly true:
 * the patient reacts in character but must never claim to see or measure the
 * clinician's emotions.
 *
 * @param {{mode: string, label: string|null, anxious: boolean|null,
 *   confidence: number}} signal
 * @param {{reactivity?: string, may_acknowledge?: boolean}} [settings]
 * @returns {string}
 */
export function renderAffectNote(signal, settings = {}) {
    if (!signal || typeof signal !== 'object') return '';
    let observation = '';
    if (signal.mode === 'dominant') {
        const phrase = LABEL_PHRASES[signal.label];
        if (!phrase) return '';
        observation = `appears ${phrase}`;
    } else if (signal.mode === 'anxious') {
        if (signal.anxious === true) observation = 'appears anxious';
        else if (signal.anxious === false) observation = 'appears calm';
        else return '';
    } else {
        return '';
    }
    const reactivity = REACTIVITY_PHRASES[settings.reactivity] || REACTIVITY_PHRASES.subtle;
    const lines = [
        'OBSERVED CLINICIAN AFFECT (this turn only):',
        `The clinician speaking with you currently ${observation} (${confidencePhrase(signal.confidence)}).`,
        reactivity,
    ];
    if (settings.may_acknowledge !== true) {
        lines.push('Never state or imply that you can see, measure, or know their emotional state — react naturally, as your character would.');
    }
    return lines.join('\n');
}

/**
 * The single server-side gate: untrusted signal + resolved provider group +
 * stored settings → the note to append, or ''. Enforces, in order: feature
 * enabled, provider policy (local-only unless an admin opted into 'any'),
 * signal validity, mode agreement with the platform setting (the platform
 * mode is authoritative — a client built against stale settings is dropped),
 * freshness, and confidence.
 *
 * @param {any} raw the `student_affect` body field
 * @param {{providerGroup?: string, settings?: object|string|null}} opts
 *   providerGroup is LLM_PROVIDERS[provider]?.group ('local'|'cloud'|'other')
 * @returns {string} rendered note, or '' to append nothing
 */
export function resolveAffectNote(raw, { providerGroup, settings } = {}) {
    const cfg = normalizeAffectSettings(settings);
    if (!cfg.enabled || cfg.affect_mode === 'off') return '';
    if (cfg.providers !== 'any' && providerGroup !== 'local') return '';
    const signal = validateAffectSignal(raw);
    if (!signal) return '';
    if (signal.mode !== cfg.affect_mode) return '';
    if (signal.age_ms > cfg.max_age_ms) return '';
    if (signal.confidence < cfg.min_confidence) return '';
    return renderAffectNote(signal, cfg);
}
