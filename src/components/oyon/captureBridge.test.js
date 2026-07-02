// Contract tests for the pure Oyon-v2 glue (captureBridge.js): the element
// `settings` attribute payload and the POST /addons/oyon/emotion-records
// body. These are the two payloads that cross host boundaries — pin them.

import { describe, it, expect } from 'vitest';
import { elementSettings, persistBody, OYON_ASSET_BASE } from './captureBridge.js';

describe('elementSettings — tenant runtime config → <oyon-app settings>', () => {
    it('maps every tenant field onto the EditableSettings key set', () => {
        const runtime = {
            model_profile: 'emotieff-mobilevit',
            sample_interval_ms: 500,
            window_ms: 10000,
            min_valid_frames: 3,
            smoothing_alpha: 0.28,
            min_hold_ms: 3000,
            min_switch_confidence: 0.5,
        };
        expect(elementSettings(runtime)).toEqual({
            model_profile: 'emotieff-mobilevit',
            sample_interval_ms: 500,
            aggregate_window_ms: 10000, // renamed: window_ms
            min_valid_frames: 3,
            smoothing_alpha: 0.28,
            min_hold_ms: 3000,
            switch_confidence: 0.5, // renamed: min_switch_confidence
        });
    });

    it('forwards only fields that are present — absent keys keep element defaults', () => {
        expect(elementSettings({ window_ms: 5000 })).toEqual({ aggregate_window_ms: 5000 });
        expect(elementSettings({})).toEqual({});
        expect(elementSettings(null)).toEqual({});
    });

    it('drops malformed values instead of forwarding them', () => {
        expect(elementSettings({
            model_profile: '   ',
            sample_interval_ms: 'fast',
            window_ms: NaN,
            min_valid_frames: Infinity,
        })).toEqual({});
    });

    it('accepts numeric strings the way the settings API stores them', () => {
        expect(elementSettings({ window_ms: '10000' })).toEqual({ aggregate_window_ms: 10000 });
    });
});

describe('persistBody — oyon:window payload → emotion-records POST body', () => {
    const win = {
        record_id: 'r-1',
        window_start: '2026-07-02T08:00:00.000Z',
        window_end: '2026-07-02T08:00:10.000Z',
        dominant_emotion: 'neutral',
        session_id: 'element-session',
    };

    it('stamps the ROHY session and case onto every event', () => {
        const body = persistBody([win], { sessionId: 'rohy-42', caseId: 'case-7' });
        expect(body.session_id).toBe('rohy-42');
        expect(body.events).toHaveLength(1);
        expect(body.events[0].session_id).toBe('rohy-42'); // element's own id overwritten
        expect(body.events[0].case_id).toBe('case-7');
        expect(body.events[0].record_id).toBe('r-1'); // payload otherwise untouched
    });

    it('defaults capture_mode and the consent_version placeholder (server overwrites it)', () => {
        const body = persistBody([win], { sessionId: 's' });
        expect(body.events[0].capture_mode).toBe('local-browser');
        expect(body.events[0].consent_version).toBe('placeholder');
        expect(body.events[0].case_id).toBeNull();
        expect(body.events[0].room).toBeNull();
    });

    it('stamps the active simulator room onto every event', () => {
        const body = persistBody([win], { sessionId: 's', room: 'examination' });
        expect(body.events[0].room).toBe('examination');
    });

    it('preserves an explicit capture_mode / consent_version when present', () => {
        const body = persistBody(
            [{ ...win, capture_mode: 'kiosk', consent_version: 'oyon-consent-v1' }],
            { sessionId: 's' },
        );
        expect(body.events[0].capture_mode).toBe('kiosk');
        expect(body.events[0].consent_version).toBe('oyon-consent-v1');
    });

    it('tolerates a non-array windows payload', () => {
        expect(persistBody(undefined, { sessionId: 's' }).events).toEqual([]);
    });
});

describe('asset base contract', () => {
    it('points at the served OyonR standalone tree (install-assets layout)', () => {
        expect(OYON_ASSET_BASE).toBe('/oyon/standalone');
    });
});
