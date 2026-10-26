// Case text reaches the 3D Bedside room as text, never as markup.
//
// Regression lock: the room package wrote casePatient()'s fields (the chief
// complaint as the room's title, the greeting as the caption, the first name
// as the speaker) into innerHTML unescaped, so an educator-authored — or
// package-imported — case carrying `<img onerror>` injected markup into every
// learner's Bedside room (security audit 2026-10-26, F-26 / L5-01). Fixed
// upstream in rohy-3d-patient-room 1.0.0-beta.3; this pins the host's view of it.
import { describe, it, expect } from 'vitest';
import { buildAppMarkup } from 'rohy-3d-patient-room';
import { casePatient } from './caseBinding.js';

const PAYLOAD = '<img src=x onerror="window.__pwned=1"><meta http-equiv="refresh" content="0;url=https://evil.example/"><a href="https://evil.example/login" style="position:fixed;inset:0">x</a>';

const HOSTILE_CASE = {
    config: {
        patient_name: `Ann${PAYLOAD} Lee`,
        greeting: `Hello doctor${PAYLOAD}`,
        demographics: { age: 58, gender: 'female', allergies: `Penicillin${PAYLOAD}` },
        structuredHistory: { chiefComplaint: `Chest pain${PAYLOAD}`, pmh: `Diabetes${PAYLOAD}` },
    },
};

describe('3D room markup from hostile case text', () => {
    it.each([
        ['bound (how rohy mounts it)', 'bound', 'host', { slim_chrome: true, exam: true, finding_card: false }],
        ['standalone', 'standalone', 'internal', {}],
    ])('%s: no element is created from the case text', (_label, mode, waveform, features) => {
        const container = document.createElement('div');
        container.innerHTML = buildAppMarkup({}, casePatient(HOSTILE_CASE), mode, waveform, features);
        expect(container.querySelector('img, meta, a[href^="https://evil"]')).toBeNull();
        // Still shown — as the text it is.
        expect(container.textContent).toContain('Chest pain<img src=x');
    });
});
