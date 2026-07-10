// Boot-time voice audit — Voice 2.0 contract (VOICE2_PLAN.md §5.5).
//
// CONTRACT REWRITE (2026-07): the audit no longer has an "active provider".
// It audits (a) the per-language default voices — warning loudly for every
// registry language without a playable fallback — and (b) each stored
// case_voice against its OWN derived engine's usability, naming the runtime
// consequence ("plays the en default …" / "has NO fallback …").
//
// No service mocks: the REAL catalogues route (same code path as
// production), and capability is controlled through settings (the audit
// injects its db adapter as the settings reader) and env stubs. Piper is
// not installed in CI; kokoro's static package catalogue is always present.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { auditPersonaAndCaseVoices } from '../../../server/healthChecks/voiceCatalogueAudit.js';

function makeDbAdapter({ settings = {}, rows = [] }) {
    return {
        get: (sql, params, cb) => {
            const key = Array.isArray(params) ? params[0] : undefined;
            cb(null, key in settings ? { setting_value: settings[key] } : null);
        },
        all: (sql, cb) => cb(null, rows),
    };
}

function makeLog() {
    return { info: vi.fn(), warn: vi.fn() };
}

function personaRow(id, caseVoice, name = `Persona ${id}`) {
    return { kind: 'persona', id, name, config: JSON.stringify({ voice: { case_voice: caseVoice } }) };
}

// Baseline settings most tests use: en playable (kokoro's static package
// catalogue is always present in CI), everything else deliberately unset.
const EN_DEFAULT = { tts_default_voice_en: 'af_bella' };

describe('auditPersonaAndCaseVoices (Voice 2.0)', () => {
    let log;

    beforeEach(() => {
        log = makeLog();
        // Capability must be deterministic: no cloud keys unless a test sets one.
        vi.stubEnv('GOOGLE_TTS_API_KEY', '');
        vi.stubEnv('GOOGLE_API_KEY', '');
        vi.stubEnv('OPENAI_API_KEY', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('warns per registry language with no default voice (the never-mute gap report)', async () => {
        const adapter = makeDbAdapter({ settings: {}, rows: [] });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        const unset = result.defaults.filter(d => d.status === 'unset').map(d => d.language).sort();
        expect(unset).toEqual(['de', 'en', 'fi', 'it', 'sv']);
        const warned = log.warn.mock.calls.filter(c => c[0] === 'no default voice for language');
        expect(warned.length).toBe(5);
    });

    it('a playable default (kokoro af_bella) audits ok; the German gap is still named', async () => {
        const adapter = makeDbAdapter({ settings: { ...EN_DEFAULT }, rows: [] });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        const byLang = Object.fromEntries(result.defaults.map(d => [d.language, d]));
        expect(byLang.en.status).toBe('ok');
        expect(byLang.de.status).toBe('unset');
        const deWarn = log.warn.mock.calls.find(
            c => c[0] === 'no default voice for language' && c[1].language === 'de'
        );
        expect(deWarn).toBeDefined();
        expect(deWarn[1].hint).toMatch(/German speakers with NO voice configured/);
    });

    it('flags a default whose engine is not usable (google voice, no key)', async () => {
        const adapter = makeDbAdapter({
            settings: { tts_default_voice_en: 'en-US-Chirp3-HD-Aoede' },
            rows: []
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        const en = result.defaults.find(d => d.language === 'en');
        expect(en.status).toBe('unplayable');
        expect(en.detail).toMatch(/needs google/);
        expect(log.warn).toHaveBeenCalledWith('default voice unplayable', expect.objectContaining({ language: 'en' }));
    });

    it('flags a default whose engine is disabled by policy', async () => {
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT, tts_provider_enabled_kokoro: '0' },
            rows: []
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        const en = result.defaults.find(d => d.language === 'en');
        expect(en.status).toBe('unplayable');
        expect(en.detail).toMatch(/disabled in settings/);
    });

    it('logs clean when every stored voice plays on its own usable engine', async () => {
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT },
            rows: [personaRow(1, 'af_bella'), personaRow(2, 'bm_lewis')]
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        expect(result.checked).toBe(2);
        expect(log.info).toHaveBeenCalledWith('voice catalogue audit clean', { checked: 2 });
    });

    it('a google voice with no key is stale, and the consequence is blunt: it fails, never substitutes', async () => {
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT },
            rows: [personaRow(7, 'en-US-Chirp3-HD-Aoede', 'Cloud Persona')]
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale.length).toBe(1);
        const entry = result.stale[0];
        expect(entry.provider).toBe('google');
        expect(entry.problem).toMatch(/not usable/);
        // v1.4 sovereignty: configured voices are literal — the en default
        // must NOT be named as a stand-in, even though it is configured.
        expect(entry.consequence).toMatch(/fails loudly/);
        expect(entry.consequence).toMatch(/never substituted/);
        expect(entry.consequence).not.toMatch(/af_bella/);
        expect(log.warn).toHaveBeenCalledWith('stale case_voice values detected', expect.objectContaining({
            stale_count: 1,
        }));
    });

    it('an unknown voice id is stale with an honest problem', async () => {
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT },
            rows: [personaRow(9, 'notavoiceanywhere')]
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale.length).toBe(1);
        expect(result.stale[0].problem).toMatch(/no provider's catalogue/);
    });

    it('tolerates malformed config JSON without throwing', async () => {
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT },
            rows: [
                { kind: 'case', id: 1, name: 'Broken', config: '{not json' },
                personaRow(2, 'af_bella')
            ]
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        // Broken row contributes to `checked` but is skipped silently — the
        // audit's job is voice validity, not JSON validity.
        expect(result.checked).toBe(2);
    });

    it('skips rows where case_voice is empty / null', async () => {
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT },
            rows: [
                { kind: 'persona', id: 1, name: 'NoVoice', config: JSON.stringify({ voice: {} }) },
                { kind: 'case', id: 2, name: 'BlankVoice', config: JSON.stringify({ voice: { case_voice: '' } }) },
                { kind: 'case', id: 3, name: 'NullVoice', config: JSON.stringify({ voice: { case_voice: null } }) },
            ]
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        expect(log.info).toHaveBeenCalledWith('voice catalogue audit clean', { checked: 3 });
    });

    it('a cloud voice with its key present audits clean (capability via env)', async () => {
        vi.stubEnv('GOOGLE_TTS_API_KEY', 'some-key');
        const adapter = makeDbAdapter({
            settings: { ...EN_DEFAULT },
            rows: [personaRow(3, 'de-DE-Chirp3-HD-Kore')]
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
    });
});
