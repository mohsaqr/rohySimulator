import { describe, expect, it } from 'vitest';
import { SCENARIO_TEMPLATES } from './scenarioTemplates';
import { LAB_PANEL_TEMPLATES } from './labPanelTemplates';
import { LAB_TEMPLATES } from './investigationTemplates';

// Audit #24: client-utils-data flagged that the static clinical templates
// (scenarios, lab panels, investigations) are clinically authored data
// shipped with the app — they're not validated at load time, so a typo
// or shape regression silently lights up at simulation runtime.
//
// These tests are *schema* checks, not clinical-correctness checks. They
// lock the structural invariants the app relies on so an editor mistake
// in the data file fails CI instead of fails a session.

const VITAL_KEYS = ['hr', 'spo2', 'rr', 'bpSys', 'bpDia', 'temp', 'etco2'];

describe('SCENARIO_TEMPLATES — schema invariants', () => {
    it('contains at least one scenario', () => {
        expect(Object.keys(SCENARIO_TEMPLATES).length).toBeGreaterThan(0);
    });

    it('every scenario has the required top-level fields', () => {
        for (const [id, scenario] of Object.entries(SCENARIO_TEMPLATES)) {
            expect(scenario.name, `${id}.name`).toBeTypeOf('string');
            expect(scenario.duration, `${id}.duration`).toBeTypeOf('number');
            expect(Array.isArray(scenario.timeline), `${id}.timeline is array`).toBe(true);
            expect(scenario.timeline.length, `${id}.timeline non-empty`).toBeGreaterThan(0);
        }
    });

    it('every timeline entry has time + label + params with all vitals', () => {
        for (const [id, scenario] of Object.entries(SCENARIO_TEMPLATES)) {
            for (const [i, step] of scenario.timeline.entries()) {
                expect(step.time, `${id}.timeline[${i}].time`).toBeTypeOf('number');
                expect(step.time, `${id}.timeline[${i}].time non-negative`).toBeGreaterThanOrEqual(0);
                expect(step.label, `${id}.timeline[${i}].label`).toBeTypeOf('string');
                expect(step.params, `${id}.timeline[${i}].params`).toBeTypeOf('object');
                for (const v of VITAL_KEYS) {
                    expect(step.params[v], `${id}.timeline[${i}].params.${v}`).toBeTypeOf('number');
                }
            }
        }
    });

    it('timeline entries are ordered by time (non-decreasing)', () => {
        for (const [id, scenario] of Object.entries(SCENARIO_TEMPLATES)) {
            for (let i = 1; i < scenario.timeline.length; i++) {
                expect(
                    scenario.timeline[i].time,
                    `${id}.timeline[${i}].time >= [${i - 1}].time`,
                ).toBeGreaterThanOrEqual(scenario.timeline[i - 1].time);
            }
        }
    });

    it('vitals stay within physiologically plausible ranges (loose)', () => {
        // Loose bounds — clinical correctness is not in scope, but a
        // negative HR or 1000% spo2 is a typo, not a scenario.
        for (const [id, scenario] of Object.entries(SCENARIO_TEMPLATES)) {
            for (const [i, step] of scenario.timeline.entries()) {
                const p = step.params;
                expect(p.hr, `${id}[${i}].hr 0-300`).toBeGreaterThanOrEqual(0);
                expect(p.hr, `${id}[${i}].hr <=300`).toBeLessThanOrEqual(300);
                expect(p.spo2, `${id}[${i}].spo2 0-100`).toBeGreaterThanOrEqual(0);
                expect(p.spo2, `${id}[${i}].spo2 <=100`).toBeLessThanOrEqual(100);
                expect(p.bpSys, `${id}[${i}].bpSys 0-300`).toBeLessThanOrEqual(300);
                expect(p.temp, `${id}[${i}].temp 25-45 °C`).toBeGreaterThanOrEqual(25);
                expect(p.temp, `${id}[${i}].temp <=45 °C`).toBeLessThanOrEqual(45);
            }
        }
    });
});

describe('LAB_PANEL_TEMPLATES — schema invariants', () => {
    it('every panel has name, description, category, and a non-empty tests array', () => {
        for (const [id, panel] of Object.entries(LAB_PANEL_TEMPLATES)) {
            expect(panel.name, `${id}.name`).toBeTypeOf('string');
            expect(panel.description, `${id}.description`).toBeTypeOf('string');
            expect(panel.category, `${id}.category`).toBeTypeOf('string');
            expect(Array.isArray(panel.tests), `${id}.tests is array`).toBe(true);
            expect(panel.tests.length, `${id}.tests non-empty`).toBeGreaterThan(0);
        }
    });

    it('every test entry has test_name and a recognised preset', () => {
        const validPresets = new Set([
            'normal',
            'low',
            'high',
            'critical_low',
            'critical_high',
        ]);
        for (const [id, panel] of Object.entries(LAB_PANEL_TEMPLATES)) {
            for (const [i, t] of panel.tests.entries()) {
                expect(t.test_name, `${id}.tests[${i}].test_name`).toBeTypeOf('string');
                expect(t.test_name.length, `${id}.tests[${i}].test_name non-empty`).toBeGreaterThan(0);
                if (t.preset !== undefined) {
                    expect(
                        validPresets.has(t.preset),
                        `${id}.tests[${i}].preset "${t.preset}" must be in ${[...validPresets].join('|')}`,
                    ).toBe(true);
                }
            }
        }
    });

    it('value_multiplier (when present) is a finite positive number', () => {
        for (const [id, panel] of Object.entries(LAB_PANEL_TEMPLATES)) {
            for (const [i, t] of panel.tests.entries()) {
                if (t.value_multiplier !== undefined) {
                    expect(Number.isFinite(t.value_multiplier), `${id}.tests[${i}]`).toBe(true);
                    expect(t.value_multiplier, `${id}.tests[${i}].value_multiplier > 0`).toBeGreaterThan(0);
                }
            }
        }
    });
});

describe('LAB_TEMPLATES (investigation) — schema invariants', () => {
    it('every template has name, category, type, turnaround, and parameters[]', () => {
        for (const [id, t] of Object.entries(LAB_TEMPLATES)) {
            expect(t.name, `${id}.name`).toBeTypeOf('string');
            expect(t.category, `${id}.category`).toBeTypeOf('string');
            expect(['lab', 'radiology', 'imaging']).toContain(t.type);
            expect(t.turnaround, `${id}.turnaround`).toBeTypeOf('number');
            expect(t.turnaround, `${id}.turnaround >= 0`).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(t.parameters), `${id}.parameters is array`).toBe(true);
        }
    });

    it('every parameter has name + unit + normalRange', () => {
        for (const [id, t] of Object.entries(LAB_TEMPLATES)) {
            for (const [i, p] of t.parameters.entries()) {
                expect(p.name, `${id}.parameters[${i}].name`).toBeTypeOf('string');
                expect(p.unit, `${id}.parameters[${i}].unit`).toBeDefined();
                expect(p.normalRange, `${id}.parameters[${i}].normalRange`).toBeTypeOf('string');
            }
        }
    });
});
