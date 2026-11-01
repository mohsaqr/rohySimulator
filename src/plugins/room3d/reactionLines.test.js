// Regression lock: PRV-64 in the 3D room — a Finnish case's patient reacted to an abnormal exam in the interface language (English), because the lines were UI-language catalogue keys
import { describe, it, expect } from 'vitest';
import { EXAM_REACTION_LINES, examReactionLine } from './reactionLines.js';
import { LANGUAGES } from '../../../server/shared/languages.js';

describe('examReactionLine', () => {
    it('speaks the case language: a Finnish chest exam is Finnish', () => {
        expect(examReactionLine('chestAnterior', 'fi')).toBe('Ai – tuohon sattuu, kun painatte.');
    });

    it('uses the language fallback for a region without its own line', () => {
        expect(examReactionLine('neck', 'sv')).toBe(EXAM_REACTION_LINES.sv.fallback);
    });

    it('speaks English for an unknown or missing case language', () => {
        expect(examReactionLine('heart', 'xx')).toBe(EXAM_REACTION_LINES.en.heart);
        expect(examReactionLine('heart', undefined)).toBe(EXAM_REACTION_LINES.en.heart);
    });

    it('does not resolve inherited keys as regions', () => {
        expect(examReactionLine('toString', 'de')).toBe(EXAM_REACTION_LINES.de.fallback);
    });
});

describe('EXAM_REACTION_LINES', () => {
    const englishKeys = Object.keys(EXAM_REACTION_LINES.en).sort();

    it.each(Object.keys(LANGUAGES))('has a full set of lines for case language %s', (code) => {
        const lines = EXAM_REACTION_LINES[code];
        expect(lines, `no reaction lines for ${code}`).toBeDefined();
        expect(Object.keys(lines).sort()).toEqual(englishKeys);
        for (const key of englishKeys) expect(lines[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
    });

    it.each(Object.keys(LANGUAGES).filter((c) => c !== 'en'))('%s is translated, not a copy of the English', (code) => {
        expect(englishKeys.filter((key) => EXAM_REACTION_LINES[code][key] === EXAM_REACTION_LINES.en[key])).toEqual([]);
    });

    it('has no lines for a language rohy does not offer', () => {
        expect(Object.keys(EXAM_REACTION_LINES).filter((c) => !(c in LANGUAGES))).toEqual([]);
    });
});
