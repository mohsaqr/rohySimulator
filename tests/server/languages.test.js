// Tests for server/shared/languages.js — the single source of truth for
// every language the app knows (I18N_PLAN.md §2). The invariants here are
// the architecture: adding a language is a data change to this registry,
// and every consumer (prompt assembly, STT lists, settings UI) derives
// from it. If these break, the "no code change per language" acceptance
// test (§7) is already broken.

import { describe, expect, it } from 'vitest';
import {
    LANGUAGES,
    DEFAULT_LANGUAGE,
    STT_DIALECTS,
    isKnownLanguage,
    llmDirectiveFor,
    sttOptions,
    sttLocaleFor
} from '../../server/shared/languages.js';

describe('LANGUAGES registry shape', () => {
    it('contains the default language', () => {
        expect(LANGUAGES[DEFAULT_LANGUAGE]).toBeDefined();
    });

    it('every entry carries the full consumer contract', () => {
        for (const [code, lang] of Object.entries(LANGUAGES)) {
            expect(code).toMatch(/^[a-z]{2}$/);
            expect(typeof lang.name).toBe('string');
            expect(typeof lang.native).toBe('string');
            expect(lang.stt).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
            expect(typeof lang.sttLabel).toBe('string');
            expect(['ltr', 'rtl']).toContain(lang.dir);
            // Directive is null (model default) or a non-empty string.
            expect(lang.llmDirective === null || (typeof lang.llmDirective === 'string' && lang.llmDirective.length > 0)).toBe(true);
        }
    });

    it("each STT locale's primary subtag matches its registry code", () => {
        // voiceMatchesLanguage and sttLocaleFor rely on this alignment.
        for (const [code, lang] of Object.entries(LANGUAGES)) {
            expect(lang.stt.split('-')[0]).toBe(code);
        }
    });

    it('English is the model default: no directive', () => {
        expect(LANGUAGES.en.llmDirective).toBeNull();
    });

    it('every non-English language has a directive naming its target', () => {
        for (const [code, lang] of Object.entries(LANGUAGES)) {
            if (code === DEFAULT_LANGUAGE) continue;
            expect(lang.llmDirective).toContain(lang.name);
        }
    });
});

describe('llmDirectiveFor', () => {
    it('returns the directive for a known non-English language', () => {
        expect(llmDirectiveFor('it')).toBe(LANGUAGES.it.llmDirective);
    });

    it('returns null for English', () => {
        expect(llmDirectiveFor('en')).toBeNull();
    });

    it('never throws on body-sourced junk — returns null', () => {
        for (const junk of [undefined, null, '', 'xx', 'IT', 42, {}, [], 'constructor', '__proto__']) {
            expect(llmDirectiveFor(junk)).toBeNull();
        }
    });
});

describe('isKnownLanguage', () => {
    it('accepts registry codes and rejects everything else', () => {
        expect(isKnownLanguage('en')).toBe(true);
        expect(isKnownLanguage('it')).toBe(true);
        expect(isKnownLanguage('xx')).toBe(false);
        expect(isKnownLanguage('toString')).toBe(false);
        expect(isKnownLanguage(null)).toBe(false);
    });
});

describe('sttOptions', () => {
    it('lists every registry language locale plus the extra dialects, deduped', () => {
        const codes = sttOptions().map(opt => opt.code);
        for (const lang of Object.values(LANGUAGES)) {
            expect(codes).toContain(lang.stt);
        }
        for (const dialect of STT_DIALECTS) {
            expect(codes).toContain(dialect.code);
        }
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('keeps the pre-registry locales so existing configs stay valid', () => {
        const codes = sttOptions().map(opt => opt.code);
        for (const legacy of ['en-US', 'en-GB', 'tr-TR', 'ar-SA', 'fr-FR', 'de-DE', 'es-ES']) {
            expect(codes).toContain(legacy);
        }
    });
});

describe('sttLocaleFor', () => {
    it('maps registry codes to their STT locale', () => {
        expect(sttLocaleFor('it')).toBe('it-IT');
        expect(sttLocaleFor('fi')).toBe('fi-FI');
    });

    it('falls back to the default language for unknown codes', () => {
        expect(sttLocaleFor('xx')).toBe(LANGUAGES[DEFAULT_LANGUAGE].stt);
        expect(sttLocaleFor(undefined)).toBe(LANGUAGES[DEFAULT_LANGUAGE].stt);
    });
});
