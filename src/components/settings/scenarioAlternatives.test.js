// QA ISSUE-0012 — wizard helpers for alternative evolutions.
import { describe, it, expect } from 'vitest';
import { keepScenarioAlternatives, scenarioAlternativeFromPick } from './ConfigPanel.jsx';
import { SCENARIO_TEMPLATES } from '../../data/scenarioTemplates';

const alts = [{ id: 'a', name: 'A', timeline: [{ time: 0 }] }];

describe('keepScenarioAlternatives', () => {
    it('returns next unchanged when there is nothing to carry', () => {
        expect(keepScenarioAlternatives(null, null)).toBeNull();
        const next = { timeline: [{ time: 0 }] };
        expect(keepScenarioAlternatives({ timeline: [] }, next)).toBe(next);
    });
    it('carries alternatives onto a replacement primary', () => {
        const out = keepScenarioAlternatives({ timeline: [{ time: 0 }], alternatives: alts }, { enabled: true, autoStart: false, timeline: [{ time: 5 }] });
        expect(out.timeline).toEqual([{ time: 5 }]);
        expect(out.alternatives).toBe(alts);
    });
    it('removing the primary keeps the alternatives in an empty shell', () => {
        const out = keepScenarioAlternatives({ timeline: [{ time: 0 }], alternatives: alts }, null);
        expect(out).toEqual({ enabled: true, autoStart: false, timeline: [], alternatives: alts });
    });
});

describe('scenarioAlternativeFromPick', () => {
    it('resolves a repository pick fully (timeline embedded) with provenance', () => {
        const repo = [{ id: 7, name: 'Sepsis (ward)', description: 'd', timeline: [{ time: 0, params: { hr: 90 } }] }];
        const alt = scenarioAlternativeFromPick('_db_7', repo);
        expect(alt).toMatchObject({ id: 'repo_7', name: 'Sepsis (ward)', description: 'd', source: { kind: 'repository', id: 7, name: 'Sepsis (ward)' } });
        expect(alt.timeline).toBe(repo[0].timeline);
    });
    it('resolves a built-in template scaled to its own duration', () => {
        const key = Object.keys(SCENARIO_TEMPLATES)[0];
        const alt = scenarioAlternativeFromPick(key, []);
        expect(alt.id).toBe(`tmpl_${key}`);
        expect(alt.name).toBe(SCENARIO_TEMPLATES[key].name);
        expect(alt.timeline.length).toBe(SCENARIO_TEMPLATES[key].timeline.length);
        expect(alt.source).toEqual({ kind: 'template', id: key, duration_minutes: SCENARIO_TEMPLATES[key].duration || 30 });
    });
    it('returns null for the placeholder, an unknown key, or a missing repository row', () => {
        expect(scenarioAlternativeFromPick('', [])).toBeNull();
        expect(scenarioAlternativeFromPick('nope', [])).toBeNull();
        expect(scenarioAlternativeFromPick('_db_99', [])).toBeNull();
    });
});
