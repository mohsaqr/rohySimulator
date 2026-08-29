import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    agentMaySeeRecord,
    renderEncounterRecord,
    RECORD_AGENT_TYPE_LIST,
} from '../../server/services/encounterRecord.js';
import { assembleSystemPrompt } from '../../server/services/systemPromptAssembly.js';

// Shaped like what patient-record-routes.js actually writes: nine named
// columns plus `details` holding JSON.stringify(event).
const row = (over = {}) => {
    const { details, ...rest } = {
        verb: 'ORDERED', time_elapsed: 4, category: 'lab', region: null, source: null,
        item: 'Troponin', content: null, finding: null, value: null, unit: null,
        abnormal: 0, ...over,
    };
    return { ...rest, details: details === undefined ? null : JSON.stringify(details) };
};

describe('agentMaySeeRecord — allowlist, not denylist', () => {
    // Regression lock: the encounter record must never reach the patient or a
    // relative. A patient who can recite their own troponin, or a daughter who
    // knows what was ordered from another room, breaks the simulation in a way
    // the learner cannot detect or challenge.
    it('never tells the patient or a relative what the learner did', () => {
        expect(agentMaySeeRecord('patient')).toBe(false);
        expect(agentMaySeeRecord('relative')).toBe(false);
    });

    it('tells the discussant and the clinical agents', () => {
        for (const type of ['discussant', 'nurse', 'consultant', 'pharmacist', 'technician']) {
            expect(agentMaySeeRecord(type)).toBe(true);
        }
    });

    // The whole point of an allowlist: a type nobody has considered yet must
    // default to silence. If this ever flips to true for an unknown string the
    // module has become a denylist and the guarantee above is gone.
    it('refuses anything unknown, empty, or not a string', () => {
        for (const bad of ['other', 'admin', '', '   ', null, undefined, 0, {}, ['discussant']]) {
            expect(agentMaySeeRecord(bad)).toBe(false);
        }
    });

    it('is case- and whitespace-insensitive for real types', () => {
        expect(agentMaySeeRecord('  Discussant ')).toBe(true);
    });

    it('the allowlist stays a strict subset of the authoring UI vocabulary', () => {
        // AGENT_TYPES in src/components/settings/AgentPersonaEditor.jsx.
        const authored = ['patient', 'discussant', 'nurse', 'consultant', 'relative', 'pharmacist', 'technician', 'other'];
        for (const type of RECORD_AGENT_TYPE_LIST) expect(authored).toContain(type);
    });
});

describe('renderEncounterRecord', () => {
    it('contributes nothing when there is nothing to say', () => {
        // '' is the contract: assembleSystemPrompt filters empty blocks, so a
        // placeholder like "no actions recorded" would be a lie on a session
        // whose sync simply has not landed yet.
        expect(renderEncounterRecord([])).toBe('');
        expect(renderEncounterRecord(null)).toBe('');
        expect(renderEncounterRecord(undefined)).toBe('');
    });

    it('drops rows that carry a verb but no substance', () => {
        expect(renderEncounterRecord([row({ item: null, category: null, region: null })])).toBe('');
        expect(renderEncounterRecord([row({ verb: 'NOT_A_VERB' })])).toBe('');
    });

    it('renders elapsed time as HH:MM, not a wall clock', () => {
        // time_elapsed is minutes since the case started, so this line can
        // never be wrong by a time zone — unlike created_at on the same table.
        const out = renderEncounterRecord([row({ time_elapsed: 71 })]);
        expect(out).toContain('[01:11] ordered Troponin (lab)');
    });

    // Regression lock: these four fields live ONLY in the details JSON. A
    // renderer that reads the named columns alone emits "examined cardiac" and
    // "gave Aspirin" — true, and useless to debrief against.
    it('recovers technique from details for EXAMINED', () => {
        const out = renderEncounterRecord([row({
            verb: 'EXAMINED', region: 'cardiac', item: null,
            details: { technique: 'auscultation', technique_detail: 'mitral area' },
        })]);
        expect(out).toContain('examined cardiac (auscultation — mitral area)');
    });

    it('recovers dose and route from details for ADMINISTERED', () => {
        const out = renderEncounterRecord([row({
            verb: 'ADMINISTERED', item: 'Aspirin',
            details: { dose: '300 mg', route: 'PO' },
        })]);
        expect(out).toContain('gave Aspirin 300 mg PO');
    });

    it('recovers the from → to transition for CHANGED', () => {
        const out = renderEncounterRecord([row({
            verb: 'CHANGED', item: null, category: 'vital', unit: 'bpm',
            details: { parameter: 'heart_rate', from: '88', to: '132' },
        })]);
        expect(out).toContain('heart_rate changed 88 → 132 bpm');
    });

    it('recovers test_name and renders value with units for ELICITED', () => {
        const out = renderEncounterRecord([row({
            verb: 'ELICITED', item: null, category: 'lab', finding: 'Markedly raised',
            value: '4.2', unit: 'ng/mL', abnormal: 1,
            details: { test_name: 'Troponin I' },
        })]);
        expect(out).toContain('found Troponin I: Markedly raised (4.2 ng/mL) [ABNORMAL]');
    });

    it('survives a details blob that is not parseable JSON', () => {
        // Named columns are authoritative; details only enriches. One bad row
        // must cost that row's richness, never the whole debrief.
        const out = renderEncounterRecord([{ ...row({ verb: 'ORDERED', item: 'CBC' }), details: '{not json' }]);
        expect(out).toContain('ordered CBC');
    });

    it('tells the model that an absent action is a real omission', () => {
        // Without this the model treats a short record as "I wasn't told",
        // and debriefs on nothing. The omission IS the teaching point.
        const out = renderEncounterRecord([row()]);
        expect(out).toMatch(/absent did not happen/i);
    });

    it('keeps the most recent actions when a session overflows the cap', () => {
        const rows = Array.from({ length: 10 }, (_, i) => row({ time_elapsed: i, item: `Test${i}` }));
        const out = renderEncounterRecord(rows, { maxEvents: 3 });
        expect(out).toContain('Test9');
        expect(out).toContain('Test7');
        expect(out).not.toContain('Test6');
        expect(out).toContain('7 earlier actions omitted');
    });

    it('says "action" not "actions" when exactly one is dropped', () => {
        const rows = Array.from({ length: 4 }, (_, i) => row({ item: `T${i}` }));
        expect(renderEncounterRecord(rows, { maxEvents: 3 })).toContain('1 earlier action omitted');
    });

    it('collapses newlines out of stored content so one event stays one line', () => {
        const out = renderEncounterRecord([row({ verb: 'OBTAINED', category: 'hpi', content: 'line one\nline two' })]);
        const body = out.split('\n').filter((l) => l.startsWith('[00:'));
        expect(body).toHaveLength(1);
        expect(body[0]).toContain('line one line two');
    });
});

describe('assembleSystemPrompt — ordering invariant with the record', () => {
    it('places the record after the case content and before the affect note', () => {
        const prompt = assembleSystemPrompt({
            system_prompt: 'CASE_CONTENT',
            systemPromptTemplate: 'PLATFORM_TEMPLATE',
            encounterRecordNote: 'RECORD_BLOCK',
            studentAffectNote: 'AFFECT_BLOCK',
        });
        // Cumulative session state sits between the stable case and the
        // per-turn affect signal; the response contract keeps recency.
        expect(prompt.indexOf('CASE_CONTENT'))
            .toBeLessThan(prompt.indexOf('PLATFORM_TEMPLATE'));
        expect(prompt.indexOf('PLATFORM_TEMPLATE'))
            .toBeLessThan(prompt.indexOf('RECORD_BLOCK'));
        expect(prompt.indexOf('RECORD_BLOCK'))
            .toBeLessThan(prompt.indexOf('AFFECT_BLOCK'));
        expect(prompt.indexOf('AFFECT_BLOCK'))
            .toBeLessThan(prompt.indexOf('plain conversational sentences'));
    });

    it('adds no separator or blank block when the record is absent', () => {
        const without = assembleSystemPrompt({ system_prompt: 'A', studentAffectNote: 'B' });
        const withEmpty = assembleSystemPrompt({ system_prompt: 'A', encounterRecordNote: '', studentAffectNote: 'B' });
        expect(withEmpty).toBe(without);
    });
});


// The unit tests above prove the gate works. These prove the ROUTE still asks
// it — the same source-scanning posture as tests/server/time-contract.test.js,
// because a gate nobody calls passes every unit test ever written.
describe('the /proxy/llm route wiring', () => {
    const proxySrc = fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server/routes/proxy-routes.js'),
        'utf8'
    );

    it('reads agent_type from the database, not the request body', () => {
        // The client names a template; the server decides what that template's
        // type may be told. Trusting a body field here would let any
        // authenticated caller ask for the record as a "discussant".
        expect(proxySrc).toMatch(/SELECT agent_type, .*FROM agent_templates/);
        expect(proxySrc).toContain('agentType = agentTemplate?.agent_type || null;');
        expect(proxySrc).not.toMatch(/agentType\s*=\s*(req\.body|agent_llm_config)/);
    });

    it('gates the record on the allowlist before loading it', () => {
        expect(proxySrc).toContain('agentMaySeeRecord(agentType)');
        // Scoped to one session, always.
        expect(proxySrc).toMatch(/FROM patient_record_events WHERE session_id = \?/);
    });

    it('passes the rendered block into the prompt assembly', () => {
        expect(proxySrc).toMatch(/assembleSystemPrompt\(\{[^}]*encounterRecordNote/);
    });
});
