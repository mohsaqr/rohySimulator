// Contract tests for the pure Oyon-v3 glue (captureBridge.js): the element
// `settings` attribute payload and the POST /addons/oyon/emotion-records
// body. These are the two payloads that cross host boundaries — pin them.

import { describe, it, expect } from 'vitest';
import { elementSettings, persistBody, persistBodies, OYON_ASSET_BASE } from './captureBridge.js';
import { OYON_MAX_BATCH_EVENTS } from '../../../server/shared/oyonRawParts.js';

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
        expect(body.schema_version).toBe('oyon-window-batch-v4');
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

    it('drops repeated AOI geometry from settings_snapshot before POST', () => {
        const body = persistBody([{
            ...win,
            settings_snapshot: {
                model_profile: 'hse-emotion-mtl',
                settings_hash: 'fnv1a32:test',
                gaze_aois: Array.from({ length: 20 }, (_, i) => ({
                    id: `aoi-${i}`,
                    x: 0,
                    y: 0,
                    width: 0.1,
                    height: 0.1,
                })),
            },
        }], { sessionId: 's' });
        expect(body.events[0].settings_snapshot).toEqual({
            model_profile: 'hse-emotion-mtl',
            settings_hash: 'fnv1a32:test',
        });
        expect(win.settings_snapshot).toBeUndefined();
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

// Oyon 3 signal flags (migration 0040). These exist so a tenant can DISABLE a
// signal: the element's own DEFAULT_SETTINGS turns gaze/eye/facial/posture/
// respiration/heart-rate on, so before these were forwarded there was no way to
// switch any of them off from Rohy.
describe('elementSettings — Oyon 3 signal flags', () => {
    it('forwards false, not just true — the whole point of the passthrough', () => {
        const out = elementSettings({
            heart_rate_enabled: false,
            respiration_enabled: false,
            facial_signals_enabled: true,
        });
        expect(out.heart_rate_enabled).toBe(false);
        expect(out.respiration_enabled).toBe(false);
        expect(out.facial_signals_enabled).toBe(true);
    });

    it('forwards the per-modality window_share fan-out', () => {
        const out = elementSettings({
            facial_signals_window_share: true,
            heart_rate_window_share: false,
            gaze_window_share: true,
        });
        expect(out.facial_signals_window_share).toBe(true);
        expect(out.heart_rate_window_share).toBe(false);
        expect(out.gaze_window_share).toBe(true);
    });

    // The element merges `settings` key-by-key with a primitive-type check, so a
    // non-boolean would be dropped on its side and read as "no opinion" here.
    it('ignores non-boolean values rather than forwarding a coercible one', () => {
        const out = elementSettings({
            heart_rate_enabled: 0,
            respiration_enabled: 'false',
            gaze_tracking_enabled: 1,
        });
        expect('heart_rate_enabled' in out).toBe(false);
        expect('respiration_enabled' in out).toBe(false);
        expect('gaze_tracking_enabled' in out).toBe(false);
    });

    it('omits every flag when the server supplies none, leaving numeric knobs intact', () => {
        const out = elementSettings({ window_ms: 10000, model_profile: 'hse-emotion-mtl' });
        for (const key of ['facial_signals_enabled', 'posture_tracking_enabled',
            'heart_rate_enabled', 'respiration_enabled', 'illumination_enabled',
            'eye_tracking_enabled', 'gaze_tracking_enabled', 'enable_dynamics']) {
            expect(key in out).toBe(false);
        }
        expect(out.aggregate_window_ms).toBe(10000);
        expect(out.model_profile).toBe('hse-emotion-mtl');
    });
});

// Oyon 3.5.11 windows carry per-sample raw_streams: one flush can outgrow a body.
describe('persistBodies — packed POST bodies', () => {
    it('packs windows into ordered bodies under the server\'s event limit, nothing dropped', () => {
        const windows = Array.from({ length: OYON_MAX_BATCH_EVENTS * 2 + 5 }, (_, i) => ({ i, window_start: 'a', window_end: 'b' }));
        const bodies = persistBodies(windows, { sessionId: 's-1', caseId: 'c' });
        expect(bodies).toHaveLength(3);
        expect(bodies.every((b) => b.events.length <= OYON_MAX_BATCH_EVENTS)).toBe(true);
        expect(bodies.flatMap((b) => b.events.map((e) => e.i))).toEqual(windows.map((w) => w.i));
    });

    it('splits by size and stamps the same envelope on every body', () => {
        const pad = 'x'.repeat(100 * 1024);
        const windows = [1, 2, 3].map((i) => ({ i, pad, window_start: 'a', window_end: 'b', modality: i === 3 ? 'raw' : undefined }));
        const bodies = persistBodies(windows, { sessionId: 's-1', caseId: 'c', room: 'chat' });
        expect(bodies.length).toBeGreaterThan(1);
        expect(bodies.flatMap((b) => b.events.map((e) => e.i))).toEqual([1, 2, 3]);
        for (const b of bodies) {
            expect(b.session_id).toBe('s-1');
            expect(b.events.every((e) => e.session_id === 's-1' && e.case_id === 'c' && e.room === 'chat')).toBe(true);
        }
    });

    it('returns no bodies for no windows', () => {
        expect(persistBodies([], { sessionId: 's' })).toEqual([]);
    });
});
