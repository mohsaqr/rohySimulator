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

// The audit now reads multiple platform_settings keys via dbAdapter.get:
// tts_provider, plus voice_<provider>_<male|female|child> for the slot
// audit. The mock routes each key through `settings` so the test can opt
// into "all slots present" / "all slots invalid" without affecting the
// case_voice audit results.
function makeDbAdapter({ provider, rows, slots = {}, patientDefaults = null }) {
    return {
        get: (sql, params, cb) => {
            const key = params?.[0];
            if (key === 'tts_provider') {
                cb(null, provider == null ? null : { setting_value: provider });
                return;
            }
            if (Object.prototype.hasOwnProperty.call(slots, key)) {
                const v = slots[key];
                cb(null, v == null ? null : { setting_value: v });
                return;
            }
            cb(null, null);
        },
        all: (sql, cb) => {
            // The audit makes two `.all` queries:
            //   1. UNION of agent_templates + cases that mention case_voice
            //      (the original catalogue audit)
            //   2. agent_templates WHERE agent_type='patient' AND
            //      is_default=1 AND config LIKE '%case_voice%' (the new
            //      footgun check)
            // The mock dispatches on the SQL so tests can set them
            // independently. `patientDefaults: null` (the default) returns
            // [] for the second query — tests opt in by passing rows.
            if (sql.includes("agent_type = 'patient'") && sql.includes('is_default = 1')) {
                cb(null, patientDefaults ?? []);
                return;
            }
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
            // Note: kind=case is used here intentionally, not kind=persona —
            // a persona with case_voice would now (correctly) trigger the
            // "patient is_default carries override" warning. We're testing
            // the catalogue audit's clean path, so route through cases.
            { kind: 'case', id: 1, name: 'CaseA', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
            { kind: 'case', id: 7, name: 'CaseB', config: JSON.stringify({ voice: { case_voice: 'af_bella' } }) },
        ];
        const adapter = makeDbAdapter({
            provider: 'kokoro',
            rows,
            slots: {
                voice_kokoro_male: 'am_liam',
                voice_kokoro_female: 'af_bella',
                voice_kokoro_child: 'af_bella',
            },
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.stale).toEqual([]);
        expect(result.patientDefaultOverrides).toEqual([]);
        expect(result.slotFindings).toEqual([]);
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
            { kind: 'persona', id: 2, name: 'Default Patient', is_default: 1, agent_type: 'patient', config: JSON.stringify({ voice: { case_voice: 'am_liam' } }) },
            { kind: 'case', id: 1, name: 'Acute Chest Pain - STEMI', config: JSON.stringify({ voice: { case_voice: 'en-US-Chirp3-HD-Orus' } }) },
            { kind: 'case', id: 7, name: 'Test1', config: JSON.stringify({ voice: { case_voice: 'bm_lewis' } }) },
            { kind: 'case', id: 99, name: 'AlsoStale', config: JSON.stringify({ voice: { case_voice: 'mystery-voice' } }) },
        ];
        const adapter = makeDbAdapter({
            provider: 'kokoro',
            rows,
            // patientDefaults defaults to [], so the footgun check finds
            // nothing here — we're testing the catalogue audit in isolation.
            slots: {
                voice_kokoro_male: 'am_liam',
                voice_kokoro_female: 'af_bella',
                voice_kokoro_child: 'af_bella',
            },
        });

        const result = await auditPersonaAndCaseVoices(adapter, log);

        expect(result.checked).toBe(4);
        expect(result.stale).toEqual([
            { kind: 'case', id: 1, name: 'Acute Chest Pain - STEMI', case_voice: 'en-US-Chirp3-HD-Orus' },
            { kind: 'case', id: 99, name: 'AlsoStale', case_voice: 'mystery-voice' },
        ]);
        expect(log.info).not.toHaveBeenCalled();
        // Two warnings now: (a) stale catalogue entries, (b) patient-default
        // template carries case_voice. Both are independent findings; we
        // check the catalogue warning explicitly and leave the footgun
        // warning for the dedicated test below.
        const calls = log.warn.mock.calls;
        const stalePayload = calls.find(([m]) => m === 'stale case_voice values detected')?.[1];
        expect(stalePayload).toMatchObject({
            provider: 'kokoro',
            stale_count: 2,
            entries: result.stale,
        });
        expect(stalePayload.hint).toContain('kokoro');
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

    it('warns when an is_default patient persona carries a case_voice override', async () => {
        // Catches the exact Orus footgun: a patient persona row that's
        // is_default=1 with a case_voice set forces every inheriting case
        // to that one voice and shadows the platform's gendered slot.
        const patientDefaults = [
            {
                id: 245, name: 'Default Patient',
                config: JSON.stringify({ voice: { case_voice: 'am_liam' } }),
            },
        ];
        const adapter = makeDbAdapter({
            provider: 'kokoro',
            rows: [],
            patientDefaults,
            slots: {
                voice_kokoro_male: 'am_liam',
                voice_kokoro_female: 'af_bella',
                voice_kokoro_child: 'af_bella',
            },
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.patientDefaultOverrides).toEqual([
            { id: 245, name: 'Default Patient', case_voice: 'am_liam' },
        ]);
        const footgunCall = log.warn.mock.calls
            .find(([m]) => m === 'patient persona is_default carries case_voice override');
        expect(footgunCall).toBeTruthy();
        expect(footgunCall[1]).toMatchObject({
            count: 1,
            entries: [{ id: 245, name: 'Default Patient', case_voice: 'am_liam' }],
        });
    });

    it('warns when a platform voice slot for the active provider is unset or invalid', async () => {
        const adapter = makeDbAdapter({
            provider: 'kokoro',
            rows: [],
            slots: {
                voice_kokoro_male: 'am_liam',        // valid
                voice_kokoro_female: '',              // unset
                voice_kokoro_child: 'not-a-voice',   // invalid
            },
        });
        const result = await auditPersonaAndCaseVoices(adapter, log);
        expect(result.slotFindings).toEqual([
            { slot: 'female', key: 'voice_kokoro_female', status: 'unset', value: null },
            { slot: 'child', key: 'voice_kokoro_child', status: 'invalid', value: 'not-a-voice' },
        ]);
        const slotCall = log.warn.mock.calls
            .find(([m]) => m === 'platform voice slot misconfigured');
        expect(slotCall).toBeTruthy();
        expect(slotCall[1]).toMatchObject({
            provider: 'kokoro',
            findings: result.slotFindings,
        });
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
