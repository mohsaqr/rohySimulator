// Contract tests for the AOI mapping + registry (port of chatoyon's
// agent-aoi suite, extended for Stage A multi-AOI gaze). The coordinate
// contract is Oyon's GazeAggregator square: [-0.5, 0.5] both axes, origin =
// physical screen center, x/y = top-left. The patient-only names are the
// back-compat shim (patientAoi.js) over the general module (screenAois.js).

import { describe, it, expect, beforeEach } from 'vitest';
import {
    patientFaceAoi, reportPatientAoi, getPatientAoi, onPatientAoi,
    FACE_BOX, MIN_AOI_SIZE, PATIENT_AOI_ID,
} from './patientAoi.js';
import {
    elementAoi, reportAoi, getAoi, getAois, onAois, resetAois, aoiLabel,
} from './screenAois.js';

// A large centered stage on a 2000×1000 viewport treated as the screen
// (no screen fields → viewport fallback).
const VIEWPORT_ENV = { innerWidth: 2000, innerHeight: 1000 };

describe('patientFaceAoi — viewport fallback mapping', () => {
    it('maps a centered stage into a centered face box', () => {
        // Stage: 600×600 centered → left 700, top 200.
        const aoi = patientFaceAoi({ left: 700, top: 200, width: 600, height: 600 }, VIEWPORT_ENV);
        expect(aoi).not.toBeNull();
        expect(aoi.id).toBe(PATIENT_AOI_ID);
        // face left = 700 + 600*0.19 = 814 → 814/2000 - 0.5 = -0.093
        expect(aoi.x).toBeCloseTo(814 / 2000 - 0.5, 10);
        expect(aoi.y).toBeCloseTo((200 + 600 * FACE_BOX.top) / 1000 - 0.5, 10);
        expect(aoi.width).toBeCloseTo((600 * FACE_BOX.width) / 2000, 10);
        expect(aoi.height).toBeCloseTo((600 * FACE_BOX.height) / 1000, 10);
    });

    it('pads a tiny stage out to the minimum resolvable AOI size', () => {
        const aoi = patientFaceAoi({ left: 900, top: 450, width: 80, height: 80 }, VIEWPORT_ENV);
        expect(aoi.width).toBe(MIN_AOI_SIZE);
        expect(aoi.height).toBe(MIN_AOI_SIZE);
    });

    it('clamps an edge-hugging stage into the gaze square', () => {
        const aoi = patientFaceAoi({ left: 1900, top: 900, width: 600, height: 600 }, VIEWPORT_ENV);
        expect(aoi.x).toBeLessThanOrEqual(0.5 - aoi.width);
        expect(aoi.y).toBeLessThanOrEqual(0.5 - aoi.height);
        expect(aoi.x).toBeGreaterThanOrEqual(-0.5);
        expect(aoi.y).toBeGreaterThanOrEqual(-0.5);
    });

    it('returns null for degenerate or fully off-viewport rects', () => {
        expect(patientFaceAoi(null, VIEWPORT_ENV)).toBeNull();
        expect(patientFaceAoi({ left: 0, top: 0, width: 0, height: 100 }, VIEWPORT_ENV)).toBeNull();
        expect(patientFaceAoi({ left: -700, top: 0, width: 600, height: 600 }, VIEWPORT_ENV)).toBeNull();
        expect(patientFaceAoi({ left: 2100, top: 0, width: 600, height: 600 }, VIEWPORT_ENV)).toBeNull();
        expect(patientFaceAoi({ left: 0, top: 0, width: 600, height: 600 }, null)).toBeNull();
    });
});

describe('patientFaceAoi — physical-screen mapping', () => {
    it('offsets by window position and browser chrome', () => {
        const env = {
            innerWidth: 1000, innerHeight: 800,
            outerWidth: 1010, outerHeight: 890,          // chromeX = 5, chromeY = 90
            screenX: 200, screenY: 100,
            screenWidth: 2560, screenHeight: 1440,
        };
        const rect = { left: 100, top: 50, width: 600, height: 600 };
        const aoi = patientFaceAoi(rect, env);
        const faceLeft = 100 + 600 * FACE_BOX.left;
        const faceTop = 50 + 600 * FACE_BOX.top;
        expect(aoi.x).toBeCloseTo((200 + 5 + faceLeft) / 2560 - 0.5, 10);
        expect(aoi.y).toBeCloseTo((100 + 90 + faceTop) / 1440 - 0.5, 10);
    });

    it('falls back to viewport mapping when screen fields are degenerate', () => {
        const env = {
            innerWidth: 2000, innerHeight: 1000,
            screenWidth: 100, screenHeight: 100, // smaller than viewport → unusable
            screenX: 0, screenY: 0,
        };
        const a = patientFaceAoi({ left: 700, top: 200, width: 600, height: 600 }, env);
        const b = patientFaceAoi({ left: 700, top: 200, width: 600, height: 600 }, VIEWPORT_ENV);
        expect(a).toEqual(b);
    });
});

describe('elementAoi — the general mapping', () => {
    it('targets the FULL rect when no inset box is given', () => {
        const aoi = elementAoi('ecg_trace', { left: 500, top: 300, width: 1000, height: 400 }, VIEWPORT_ENV);
        expect(aoi).toEqual({
            id: 'ecg_trace',
            x: 500 / 2000 - 0.5,
            y: 300 / 1000 - 0.5,
            width: 1000 / 2000,
            height: 400 / 1000,
        });
    });

    it('applies an inset box exactly like patientFaceAoi', () => {
        const rect = { left: 700, top: 200, width: 600, height: 600 };
        const viaElement = elementAoi(PATIENT_AOI_ID, rect, VIEWPORT_ENV, { insetBox: FACE_BOX });
        expect(viaElement).toEqual(patientFaceAoi(rect, VIEWPORT_ENV));
    });

    it('rejects a missing id and keeps the degenerate-rect guards', () => {
        expect(elementAoi('', { left: 0, top: 0, width: 100, height: 100 }, VIEWPORT_ENV)).toBeNull();
        expect(elementAoi('chat_panel', { left: 0, top: 0, width: 0, height: 100 }, VIEWPORT_ENV)).toBeNull();
        expect(elementAoi('chat_panel', { left: 2100, top: 0, width: 600, height: 600 }, VIEWPORT_ENV)).toBeNull();
    });

    it('pads tiny full-rect targets to the minimum resolvable size', () => {
        const aoi = elementAoi('vitals_values', { left: 900, top: 450, width: 80, height: 80 }, VIEWPORT_ENV);
        expect(aoi.width).toBe(MIN_AOI_SIZE);
        expect(aoi.height).toBe(MIN_AOI_SIZE);
    });
});

describe('AOI registry', () => {
    beforeEach(() => resetAois());

    const box = (id, x = 0) => ({ id, x, y: 0, width: 0.2, height: 0.2 });

    it('accumulates AOIs per id, in stable first-report order', () => {
        reportAoi('patient_face', box('patient_face'));
        reportAoi('ecg_trace', box('ecg_trace', 0.1));
        reportAoi('vitals_values', box('vitals_values', 0.2));
        expect(getAois().map((a) => a.id)).toEqual(['patient_face', 'ecg_trace', 'vitals_values']);
        expect(getAoi('ecg_trace')).toEqual(box('ecg_trace', 0.1));
    });

    it('null removes an AOI from getAois() but keeps its order slot', () => {
        reportAoi('patient_face', box('patient_face'));
        reportAoi('ecg_trace', box('ecg_trace', 0.1));
        reportAoi('patient_face', null);
        expect(getAois().map((a) => a.id)).toEqual(['ecg_trace']);
        expect(getAoi('patient_face')).toBeNull();
        reportAoi('patient_face', box('patient_face', 0.3)); // returns to its ORIGINAL slot
        expect(getAois().map((a) => a.id)).toEqual(['patient_face', 'ecg_trace']);
    });

    it('notifies listeners with the FULL array on any change, deduping no-ops', () => {
        const seen = [];
        const off = onAois((list) => seen.push(list));
        reportAoi('patient_face', box('patient_face'));
        reportAoi('patient_face', { ...box('patient_face') }); // structurally identical → deduped
        reportAoi('ecg_trace', box('ecg_trace', 0.1));
        reportAoi('ecg_trace', null);
        off();
        reportAoi('chat_panel', box('chat_panel')); // after unsubscribe → not seen
        expect(seen).toEqual([
            [box('patient_face')],
            [box('patient_face'), box('ecg_trace', 0.1)],
            [box('patient_face')],
        ]);
    });

    it('ignores reports without a usable id', () => {
        reportAoi('', box(''));
        reportAoi(undefined, box('x'));
        expect(getAois()).toEqual([]);
    });

    it('labels the known Rohy ids (case-insensitively), capitalizing unknown ids', () => {
        expect(aoiLabel('patient_face')).toBe('Patient');
        expect(aoiLabel('ecg_trace')).toBe('ECG');
        expect(aoiLabel('vitals_values')).toBe('Vitals');
        expect(aoiLabel('chat_panel')).toBe('Chat');
        // Two-era casing drift maps onto the same label.
        expect(aoiLabel('Chat_Panel')).toBe('Chat');
        expect(aoiLabel('chat')).toBe('Chat');
        expect(aoiLabel('Chat')).toBe('Chat');
        expect(aoiLabel('ecg')).toBe('ECG');
        expect(aoiLabel('ECG')).toBe('ECG');
        // Unknown ids: first letter upper on the canonical lowercased id.
        expect(aoiLabel('mystery_widget')).toBe('Mystery_widget');
    });
});

describe('patient AOI store (back-compat shim)', () => {
    beforeEach(() => resetAois());

    it('publishes to subscribers and dedupes identical reports', () => {
        const seen = [];
        const off = onPatientAoi((aoi) => seen.push(aoi));
        const aoi = { id: PATIENT_AOI_ID, x: 0, y: 0, width: 0.2, height: 0.2 };
        reportPatientAoi(aoi);
        reportPatientAoi({ ...aoi }); // structurally identical → deduped
        reportPatientAoi(null);
        off();
        reportPatientAoi(aoi); // after unsubscribe → not seen
        expect(seen).toEqual([aoi, null]);
        expect(getPatientAoi()).toEqual(aoi);
    });

    it('only fires for PATIENT changes — other AOIs are filtered out', () => {
        const seen = [];
        const off = onPatientAoi((aoi) => seen.push(aoi));
        reportAoi('ecg_trace', { id: 'ecg_trace', x: 0.1, y: 0, width: 0.2, height: 0.2 });
        const patient = { id: PATIENT_AOI_ID, x: 0, y: 0, width: 0.2, height: 0.2 };
        reportPatientAoi(patient);
        reportAoi('ecg_trace', null);
        off();
        expect(seen).toEqual([patient]);
    });
});
