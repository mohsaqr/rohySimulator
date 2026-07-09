// Shared voice-catalogue helpers for UI surfaces that bind a provider voice
// to a gender/age slot. Provider metadata is uneven: Google/OpenAI/Kokoro
// expose gender, Piper often does not. Unknown/neutral voices remain visible
// so admins are never blocked by incomplete metadata, but known opposite-sex
// voices are filtered out of gendered slots.

import { deriveDemographicSlot } from './demographics.js';

const FEMALE_NAME_HINTS = /\b(amy|bella|aoede|kore|leda|zephyr|nova|shimmer|female|woman|girl)\b/i;
const MALE_NAME_HINTS = /\b(ryan|michael|charon|puck|orus|fenrir|echo|fable|onyx|male|man|boy)\b/i;
const CHILD_NAME_HINTS = /\b(child|kid|youth|young)\b/i;

export function voiceSlotForDemographics(gender, age) {
    return deriveDemographicSlot(gender, age);
}

export function normalizeVoiceGender(voice) {
    const explicit = String(voice?.gender || '').trim().toLowerCase();
    if (explicit.startsWith('f')) return 'female';
    if (explicit.startsWith('m')) return 'male';
    if (explicit.includes('child') || explicit.includes('youth')) return 'child';
    if (explicit.includes('neutral')) return 'neutral';

    const haystack = `${voice?.displayName || ''} ${voice?.filename || ''}`.replace(/[_-]+/g, ' ');
    if (CHILD_NAME_HINTS.test(haystack)) return 'child';
    if (FEMALE_NAME_HINTS.test(haystack)) return 'female';
    if (MALE_NAME_HINTS.test(haystack)) return 'male';
    return '';
}

export function voiceMatchesSlot(voice, slot) {
    const g = normalizeVoiceGender(voice);
    if (!g || g === 'neutral') return true;
    if (slot === 'child') return g === 'child' || g === 'female';
    return g === slot;
}

export function voicesForSlot(voices, slot, selectedVoice = '') {
    const list = Array.isArray(voices) ? voices : [];
    const matching = list.filter(v => voiceMatchesSlot(v, slot));
    if (!selectedVoice || matching.some(v => v.filename === selectedVoice)) return matching;
    const selected = list.find(v => v.filename === selectedVoice);
    return selected ? [selected, ...matching] : matching;
}

export function voiceGenderLabel(voice) {
    const g = normalizeVoiceGender(voice);
    return g || voice?.gender || '';
}

// Group a provider voice list by its `language` tag for <optgroup> rendering.
// Returns [{ language, voices }] with English groups first (most catalogues
// and personas are English), then the rest alphabetically, then a final
// group with language '' for voices whose metadata carries no language
// (some Piper sidecars). Ordering inside each group is preserved as-is —
// providers already list their best voices first.
export function groupVoicesByLanguage(voices) {
    const list = Array.isArray(voices) ? voices : [];
    const byLang = new Map();
    for (const v of list) {
        const lang = typeof v?.language === 'string' && v.language !== 'unknown' ? v.language : '';
        if (!byLang.has(lang)) byLang.set(lang, []);
        byLang.get(lang).push(v);
    }
    const langs = [...byLang.keys()].sort((a, b) => {
        if (a === '') return 1;
        if (b === '') return -1;
        const aEn = a.toLowerCase().startsWith('en');
        const bEn = b.toLowerCase().startsWith('en');
        if (aEn !== bEn) return aEn ? -1 : 1;
        return a.localeCompare(b);
    });
    return langs.map(language => ({ language, voices: byLang.get(language) }));
}
