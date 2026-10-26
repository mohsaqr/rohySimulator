// Regression lock: terms 1.2 name the optional heart-rate and breathing-rate estimates under the one camera consent, and say they are rough, not medical-grade (owner decision 2026-10-26).
//
// rc.89 gated stored heart rate and respiration on `oyon_consent_physio`; the
// terms (§7: "facial-expression estimates and gaze") did not name them, so the
// switch would have recorded agreement to data the agreement never described.
// A changed meaning needs a changed version — acceptance is keyed on it — and
// every shipped translation must render the same version, paragraph for paragraph.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMS_BODY, DEFAULT_TERMS_VERSION, parseTermsBody } from '../../server/shared/terms.js';
import { DEFAULT_TERMS_TRANSLATIONS } from '../../server/shared/termsTranslations.js';

const SECTION_7 = 'from the webcam (facial-expression estimates, gaze, and — if the learner switches it on — rough estimates of heart rate and breathing rate derived from the camera image),';
const SECTION_8 = 'The optional learning measures, including any heart-rate and breathing-rate estimates, are rough estimates for learning feedback only. They are not psychological or medical assessments, are not medical-grade measurements, and are not used as such.';

const paragraphs = (body) => parseTermsBody(body).filter((b) => b.type === 'paragraph');

describe('default terms 1.2: heart rate and breathing under the camera consent', () => {
    it('is version 1.2', () => {
        expect(DEFAULT_TERMS_VERSION).toBe('1.2');
    });

    it('§7 names the optional heart-rate and breathing-rate estimates from the camera', () => {
        expect(DEFAULT_TERMS_BODY).toContain(SECTION_7);
        expect(DEFAULT_TERMS_BODY).not.toContain('from the webcam (facial-expression estimates and gaze)');
    });

    it('§8 says the estimates are rough and not medical-grade', () => {
        expect(DEFAULT_TERMS_BODY).toContain(SECTION_8);
        expect(DEFAULT_TERMS_BODY).not.toContain('are not psychological, medical or physiological assessments');
    });

    it.each(Object.keys(DEFAULT_TERMS_TRANSLATIONS))('the %s translation keeps the English paragraph count', (lang) => {
        const english = parseTermsBody(DEFAULT_TERMS_BODY);
        const translated = parseTermsBody(DEFAULT_TERMS_TRANSLATIONS[lang].body);
        expect(paragraphs(DEFAULT_TERMS_TRANSLATIONS[lang].body)).toHaveLength(paragraphs(DEFAULT_TERMS_BODY).length);
        expect(translated.map((b) => b.type)).toEqual(english.map((b) => b.type));
    });

    it.each(Object.keys(DEFAULT_TERMS_TRANSLATIONS))('the %s translation carries the changed §7 and §8 sentences', (lang) => {
        const blocks = parseTermsBody(DEFAULT_TERMS_TRANSLATIONS[lang].body);
        const english = parseTermsBody(DEFAULT_TERMS_BODY);
        const s7 = english.findIndex((b) => b.type === 'paragraph' && b.text.includes(SECTION_7));
        const s8 = english.findIndex((b) => b.type === 'paragraph' && b.text === SECTION_8);
        // The translated paragraphs at those positions now mention a heart-rate
        // term in each language — the old 1.1 sentences mention none.
        const heart = /Herzfrequenz|frecuencia cardíaca|frequenza cardiaca|fréquence cardiaque|syke|sykk|puls|жүрек соғу/i;
        expect(blocks[s7].text).toMatch(heart);
        expect(blocks[s8].text).toMatch(heart);
    });
});
