// Boot-time audit detects stale case_voice values across personas + cases.
// We test it with a mocked dbAdapter + injectable log so the assertions
// don't depend on the real SQLite path or the real catalogue services.
//
// The Kokoro/OpenAI/Google catalogue lookups are exercised by mocking the
// service modules — vi.mock is hoisted, so the mocks are in place by the
// time auditPersonaAndCaseVoices imports them dynamically.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/services/kokoroTts.js', () => ({
    isKokoroVoice: vi.fn(async (v) => ['am_liam', 'af_bella', 'bm_lewis'].includes(v)),
    loadKokoro: vi.fn(async () => {}),
}));
vi.mock('../../../server/services/openaiTts.js', () => ({
    isOpenaiVoice: vi.fn((v) => ['nova', 'onyx', 'shimmer'].includes(v)),
}));
vi.mock('../../../server/services/googleTts.js', () => ({
    isGoogleVoice: vi.fn((v) => ['en-US-Neural2-A', 'en-US-Neural2-F'].includes(v)),
}));

import { auditPersonaAndCaseVoices } from '../../../server/healthChecks/voiceCatalogueAudit.js';

function makeDbAdapter({ provider, rows }) {
    return {
        get: (sql, params, cb) => {
            // The audit only calls .get for the tts_provider setting.
            cb(null, provider == null ? null : { setting_value: provider });
        },
        all: (sql, cb) => {
            cb(null, rows);
        },
    };
}

function makeLog() {
    return { info: vi.fn(), warn: vi.fn() };
}

describe('auditPersonaAndCaseVoices', () => {
    let log;

    beforeEach(() => {
        log = makeLog();
    });

    it('skips audit when tts_provider is unset', async () => {
        const adapter = makeDbAdapter({ provider: null, rows: [] });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result).toEqual({ provider: null, checked: 0, stale: [] });
        expect(log.info).toHaveBeenCalledWith('tts_provider unset; skipping voice catalogue audit');
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('warns and returns provider when provider is unknown', async () => {
        const adapter = makeDbAdapter({ provider: 'banana', rows: [] });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.provider).toBe('banana');
        expect(result.stale).toEqual([]);
        expect(log.warn).toHaveBeenCalledWith(
            'cannot audit case_voice values; unknown provider',
            { provider: 'banana' }
        );
    });

    it('logs clean when no rows store a case_voice', async () => {
        const adapter = makeDbAdapter({ provider: 'kokoro', rows: [] });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        expect(log.info).toHaveBeenCalledWith(
            'voice catalogue audit clean',
            { provider: 'kokoro', checked: 0 }
        );
    });

    it('logs clean when every stored case_voice is in the active catalogue', async () => {
        const rows = [
            { kind: 'persona', id: 1, name: 'Patient', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
            { kind: 'case', id: 7, name: 'Test1', config: JSON.stringify({ voice: { case_voice: 'af_bella' } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'kokoro', rows });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        expect(log.info).toHaveBeenCalledWith(
            'voice catalogue audit clean',
            { provider: 'kokoro', checked: 2 }
        );
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('warns and enumerates every stale row when case_voice is not in the catalogue', async () => {
        // The exact Orus regression that triggered the three-week chase:
        // a case kept a Google voice id under a kokoro provider.
        const rows = [
            { kind: 'persona', id: 2, name: 'Default Patient', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
            { kind: 'case', id: 1, name: 'Acute Chest Pain - STEMI', config: JSON.stringify({ voice: { case_voice: 'en-US-Chirp3-HD-Orus' } }) },
            { kind: 'case', id: 7, name: 'Test1', config: JSON.stringify({ voice: { case_voice: 'bm_lewis' } }) },
            { kind: 'case', id: 99, name: 'AlsoStale', config: JSON.stringify({ voice: { case_voice: 'mystery-voice' } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'kokoro', rows });

        const result = await auditPersonaAndCaseVoices(adapter, log);

        expect(result.checked).toBe(4);
        expect(result.stale).toEqual([
            { kind: 'case', id: 1, name: 'Acute Chest Pain - STEMI', case_voice: 'en-US-Chirp3-HD-Orus' },
            { kind: 'case', id: 99, name: 'AlsoStale', case_voice: 'mystery-voice' },
        ]);
        expect(log.info).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledTimes(1);
        const [msg, payload] = log.warn.mock.calls[0];
        expect(msg).toBe('stale case_voice values detected');
        expect(payload).toMatchObject({
            provider: 'kokoro',
            stale_count: 2,
            entries: result.stale,
        });
        expect(payload.hint).toContain('kokoro');
    });

    it('tolerates malformed config JSON without throwing', async () => {
        const rows = [
            { kind: 'persona', id: 5, name: 'BrokenJSON', config: '{not json' },
            { kind: 'case', id: 6, name: 'OK', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'kokoro', rows });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        // Broken row contributes to `checked` but is skipped silently — the
        // audit's job is voice validity, not JSON validity.
        expect(result.checked).toBe(2);
    });

    it('skips rows where case_voice is empty / null', async () => {
        const rows = [
            { kind: 'persona', id: 1, name: 'NoVoice', config: JSON.stringify({ voice: {} }) },
            { kind: 'case', id: 2, name: 'BlankVoice', config: JSON.stringify({ voice: { case_voice: '' } }) },
            { kind: 'case', id: 3, name: 'NullVoice', config: JSON.stringify({ voice: { case_voice: null } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'kokoro', rows });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        expect(log.info).toHaveBeenCalledWith(
            'voice catalogue audit clean',
            { provider: 'kokoro', checked: 3 }
        );
    });

    it('audits openai voices when openai is the active provider', async () => {
        const rows = [
            { kind: 'persona', id: 1, name: 'Patient', config: JSON.stringify({ voice: { case_voice: 'nova' } }) },
            { kind: 'case', id: 2, name: 'WrongProvider', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'openai', rows });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([
            { kind: 'case', id: 2, name: 'WrongProvider', case_voice: 'am_liam' },
        ]);
    });

    it('audits google voices when google is the active provider', async () => {
        const rows = [
            { kind: 'persona', id: 1, name: 'Patient', config: JSON.stringify({ voice: { case_voice: 'en-US-Neural2-F' } }) },
            { kind: 'case', id: 2, name: 'OrusBack', config: JSON.stringify({ voice: { case_voice: 'en-US-Chirp3-HD-Orus' } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'google', rows });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([
            { kind: 'case', id: 2, name: 'OrusBack', case_voice: 'en-US-Chirp3-HD-Orus' },
        ]);
    });

    it('treats a validator throw as "stale" rather than crashing the audit', async () => {
        // If kokoroTts.isKokoroVoice() rejects for some reason (e.g. model
        // not loaded yet), the audit should report the voice as stale and
        // keep going — it must not abort the whole boot.
        const kokoro = await import('../../../server/services/kokoroTts.js');
        kokoro.isKokoroVoice.mockImplementationOnce(async () => { throw new Error('not ready'); });
        const rows = [
            { kind: 'persona', id: 1, name: 'Patient', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
            { kind: 'case', id: 2, name: 'OK', config: JSON.stringify({ voice: { case_voice: 'af_bella' } }) },
        ];
        const adapter = makeDbAdapter({ provider: 'kokoro', rows });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        // The first row threw → stale. The second is valid → clean.
        expect(result.stale).toEqual([
            { kind: 'persona', id: 1, name: 'Patient', case_voice: 'am_liam' },
        ]);
    });
});
