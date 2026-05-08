// Phase 3 — discussionService contract + regression tests.
//
// Locks the public surface of src/services/discussionService.js:
//
//   1. fetchDiscussantForCase(caseId)
//        Resolution chain — case-attached discussant -> platform default
//        template -> first discussant template -> null. The 2026-05-06
//        discussant-voice bug travelled through this call path; the voice
//        slot in the returned shape MUST surface from config so the
//        downstream resolveDiscussantVoice() in useDiscussionEngine.js can
//        pick the right server voice file.
//
//   2. normalizeAgent(rawAgent)
//        normalizeAgent is NOT exported — it's an internal helper. We
//        exercise it through fetchDiscussantForCase by varying the raw
//        agent row the mocked endpoint returns and asserting the resolved
//        shape (id, name, voice, gender, rawConfig) on the result. This
//        keeps us honest: we test the public contract, not internals.
//
//   3. buildCaseContext(activeCase, contextFilter)
//        Filters case fields for safe inclusion in the LLM system prompt.
//        Must:
//          - return '' for missing case or contextFilter==='minimal',
//          - include patient + chief complaint at all non-minimal levels,
//          - escalate detail through 'history' / 'vitals' / 'full',
//          - emit the SPOILER GUARD note so the discussant doesn't assume
//            the learner did anything.
//
// HTTP surface is stubbed via msw. localStorage is reset by tests/setup.js
// between tests so token isolation is automatic. AgentService.getTemplates
// is exercised via its real fetch path (also msw-stubbed) — we don't mock
// the module so the real fallback chain is observed end-to-end.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
    fetchDiscussantForCase,
    buildCaseContext,
} from './discussionService.js';

// ---------------------------------------------------------------------------
// msw mock state
//
// Each test mutates `caseAgentsByCaseId` and `templatesResponse` to set up
// the server's behavior, then calls fetchDiscussantForCase. afterEach
// resets both so tests don't bleed.
// ---------------------------------------------------------------------------

let caseAgentsByCaseId = new Map();
let templatesResponse = [];
let caseAgentsStatus = 200;
const seenRequests = [];

const server = setupServer(
    http.get('*/api/cases/:caseId/agents', ({ params, request }) => {
        seenRequests.push({ url: request.url, caseId: params.caseId });
        if (caseAgentsStatus !== 200) {
            return new HttpResponse(null, { status: caseAgentsStatus });
        }
        const agents = caseAgentsByCaseId.get(String(params.caseId)) || [];
        return HttpResponse.json({ agents });
    }),
    http.get('*/api/agents/templates', () => {
        return HttpResponse.json({ templates: templatesResponse });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers(
        http.get('*/api/cases/:caseId/agents', ({ params, request }) => {
            seenRequests.push({ url: request.url, caseId: params.caseId });
            if (caseAgentsStatus !== 200) {
                return new HttpResponse(null, { status: caseAgentsStatus });
            }
            const agents = caseAgentsByCaseId.get(String(params.caseId)) || [];
            return HttpResponse.json({ agents });
        }),
        http.get('*/api/agents/templates', () => {
            return HttpResponse.json({ templates: templatesResponse });
        }),
    );
    caseAgentsByCaseId = new Map();
    templatesResponse = [];
    caseAgentsStatus = 200;
    seenRequests.length = 0;
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// fetchDiscussantForCase — resolution chain (case -> default -> first -> null)
// ---------------------------------------------------------------------------

describe('fetchDiscussantForCase — resolution chain', () => {
    it('returns the case-attached discussant when one exists (branch 1)', async () => {
        // CONTRACT: a case_agents row with agent_type==='discussant' and
        // enabled !== 0 wins over any platform template.
        caseAgentsByCaseId.set('42', [
            {
                id: 999,
                agent_template_id: 7,
                agent_type: 'discussant',
                enabled: 1,
                name: 'Case Tutor',
                role_title: 'Senior Mentor',
                system_prompt: 'You are a case-specific tutor.',
                config: { voice: { file: 'en-case-1', gender: 'female' } },
            },
            // A non-discussant must be ignored even though it's first.
            { id: 1, agent_type: 'consultant', enabled: 1, name: 'Consultant' },
        ]);
        // Templates exist but should NOT be returned because the case
        // already has an attached discussant.
        templatesResponse = [
            { id: 100, agent_type: 'discussant', is_default: 1, name: 'Platform Default' },
        ];

        const result = await fetchDiscussantForCase(42);
        expect(result).toBeTruthy();
        expect(result.id).toBe(999);
        expect(result.name).toBe('Case Tutor');
        expect(result.roleTitle).toBe('Senior Mentor');
    });

    it('skips disabled (enabled===0) case discussants and falls through to templates', async () => {
        caseAgentsByCaseId.set('5', [
            {
                id: 1,
                agent_type: 'discussant',
                enabled: 0,
                name: 'Disabled Tutor',
                config: {},
            },
        ]);
        templatesResponse = [
            { id: 200, agent_type: 'discussant', is_default: 1, name: 'Default Tutor', config: {} },
        ];
        const result = await fetchDiscussantForCase(5);
        expect(result).toBeTruthy();
        expect(result.id).toBe(200);
        expect(result.name).toBe('Default Tutor');
    });

    it('falls back to platform default discussant template when case has no agents (branch 2)', async () => {
        // Case has no attached discussant; platform default wins.
        caseAgentsByCaseId.set('1', []);
        templatesResponse = [
            { id: 50, agent_type: 'consultant', is_default: 1, name: 'Other' },
            { id: 51, agent_type: 'discussant', is_default: 0, name: 'Backup' },
            { id: 52, agent_type: 'discussant', is_default: 1, name: 'Platform Default Discussant', config: {} },
        ];
        const result = await fetchDiscussantForCase(1);
        expect(result).toBeTruthy();
        expect(result.id).toBe(52);
        expect(result.name).toBe('Platform Default Discussant');
    });

    it('falls back to the first discussant template when no is_default exists (branch 2b)', async () => {
        // CONTRACT: when no template has is_default truthy, the source
        // takes the first discussant-typed template via Array.find.
        caseAgentsByCaseId.set('99', []);
        templatesResponse = [
            { id: 70, agent_type: 'consultant', is_default: 0, name: 'Cons' },
            { id: 71, agent_type: 'discussant', is_default: 0, name: 'First Discussant', config: {} },
            { id: 72, agent_type: 'discussant', is_default: 0, name: 'Second Discussant', config: {} },
        ];
        const result = await fetchDiscussantForCase(99);
        expect(result).toBeTruthy();
        expect(result.id).toBe(71);
    });

    it('returns null when no discussant exists anywhere (branch 3 — graceful disable)', async () => {
        caseAgentsByCaseId.set('123', []);
        templatesResponse = [
            { id: 1, agent_type: 'consultant', is_default: 1, name: 'Only consultant' },
        ];
        const result = await fetchDiscussantForCase(123);
        expect(result).toBeNull();
    });

    it('skips the case-agents fetch entirely when caseId is falsy', async () => {
        // CONTRACT: source guards `if (caseId)` — passing null/undefined/0
        // must NOT issue a /cases/:id/agents request.
        templatesResponse = [
            { id: 30, agent_type: 'discussant', is_default: 1, name: 'Default Only' },
        ];
        const result = await fetchDiscussantForCase(null);
        expect(result).toBeTruthy();
        expect(result.id).toBe(30);
        // No /api/cases/:id/agents request should have been made.
        expect(seenRequests.length).toBe(0);
    });

    it('falls through to templates when /cases/:id/agents returns a non-OK status', async () => {
        // CONTRACT: a 500 from the case-agents endpoint must NOT fail the
        // whole resolution; it just means "no case override" and we proceed
        // to platform defaults.
        caseAgentsStatus = 500;
        templatesResponse = [
            { id: 88, agent_type: 'discussant', is_default: 1, name: 'After 500', config: {} },
        ];
        const result = await fetchDiscussantForCase(42);
        expect(result).toBeTruthy();
        expect(result.id).toBe(88);
    });
});

// ---------------------------------------------------------------------------
// normalizeAgent — exercised through fetchDiscussantForCase
//
// We feed the case-agents endpoint different raw shapes and assert the
// normalized result. This is the discussant-voice bug regression suite.
// ---------------------------------------------------------------------------

describe('normalizeAgent (via fetchDiscussantForCase) — discussant-voice contract', () => {
    function setCase(caseId, raw) {
        caseAgentsByCaseId.set(String(caseId), [
            { agent_type: 'discussant', enabled: 1, ...raw },
        ]);
    }

    it('parses config when it arrives as a JSON string', async () => {
        // CONTRACT: SQLite returns config as TEXT; the source calls
        // JSON.parse via parseConfig(). The voice block must survive.
        setCase(1, {
            id: 1,
            name: 'Tutor',
            config: JSON.stringify({
                voice: { file: 'en-female-2', gender: 'female' },
                unlock_trigger: 'manual',
            }),
        });
        const result = await fetchDiscussantForCase(1);
        expect(result.rawConfig).toEqual({
            voice: { file: 'en-female-2', gender: 'female' },
            unlock_trigger: 'manual',
        });
        expect(result.unlockTrigger).toBe('manual');
        expect(result.voice).toMatchObject({ file: 'en-female-2', gender: 'female' });
    });

    it('passes through config when it arrives already parsed (object)', async () => {
        setCase(2, {
            id: 2,
            name: 'Tutor',
            config: { voice: { file: 'en-male-3', gender: 'male' } },
        });
        const result = await fetchDiscussantForCase(2);
        expect(result.rawConfig.voice.file).toBe('en-male-3');
        expect(result.voice.file).toBe('en-male-3');
        expect(result.gender).toBe('male');
    });

    it('returns rawConfig as {} when config is missing entirely (and no override)', async () => {
        setCase(3, { id: 3, name: 'No Config Tutor' });
        const result = await fetchDiscussantForCase(3);
        expect(result.rawConfig).toEqual({});
        // No gender anywhere -> voice block is null (resolveDiscussantVoice
        // will fall back to its 'male' default).
        expect(result.voice).toBeNull();
        expect(result.gender).toBeNull();
    });

    it('returns rawConfig as {} when config is malformed JSON (silent recovery)', async () => {
        // CONTRACT: parseConfig wraps JSON.parse in try/catch and returns
        // null on failure; normalizeAgent || {}-coalesces to an empty obj.
        setCase(4, { id: 4, name: 'Broken Config', config: '{not json' });
        const result = await fetchDiscussantForCase(4);
        expect(result.rawConfig).toEqual({});
        expect(result.voice).toBeNull();
    });

    it('falls back to config_override when primary config is missing', async () => {
        // CONTRACT: per-case overrides live in case_agents.config_override.
        // When the agent_template's config didn't load (e.g., template
        // deleted), the override carries the voice settings.
        setCase(5, {
            id: 5,
            name: 'Override Only',
            config_override: JSON.stringify({ voice: { file: 'en-override-1', gender: 'female' } }),
        });
        const result = await fetchDiscussantForCase(5);
        expect(result.voice).toMatchObject({ file: 'en-override-1', gender: 'female' });
        expect(result.gender).toBe('female');
    });

    it('promotes config.voice.gender to top-level gender (discussant-voice bug regression)', async () => {
        // CONTRACT — the 2026-05-06 bug: voice.gender from config wasn't
        // surfacing on the normalized agent, so resolveDiscussantVoice in
        // useDiscussionEngine.js fell through to its default 'male' slot
        // even when admin had picked a female case_voice. Lock the
        // promotion: voice.gender wins over top-level config.gender.
        setCase(6, {
            id: 6,
            name: 'Discussant',
            config: { gender: 'male', voice: { file: 'en-female-x', gender: 'female' } },
        });
        const result = await fetchDiscussantForCase(6);
        expect(result.gender).toBe('female');
        expect(result.voice.gender).toBe('female');
        expect(result.voice.file).toBe('en-female-x');
    });

    it('uses top-level config.gender when voice block has no gender override', async () => {
        // CONTRACT: admin sets config.gender (top-level) without picking a
        // specific voice; normalizeAgent must still surface gender so the
        // slot resolver can pick a default voice for that gender.
        setCase(7, {
            id: 7,
            name: 'Tutor',
            config: { gender: 'female', voice: { file: 'en-shared' } },
        });
        const result = await fetchDiscussantForCase(7);
        expect(result.gender).toBe('female');
        expect(result.voice).toMatchObject({ file: 'en-shared', gender: 'female' });
    });

    it('emits voice with only gender when config has gender but no voice block', async () => {
        // CONTRACT: gender alone is enough to build a minimal voice slot
        // hint ({ gender }); resolveDiscussantVoice reads that and asks
        // the resolver for the gender-default voice.
        setCase(8, { id: 8, name: 'Tutor', config: { gender: 'male' } });
        const result = await fetchDiscussantForCase(8);
        expect(result.gender).toBe('male');
        expect(result.voice).toEqual({ gender: 'male' });
    });

    it('uses sensible defaults for missing top-level fields', async () => {
        // CONTRACT: when name/role/etc are absent, the normalized shape
        // still has predictable values (used by the UI without guards).
        setCase(9, { id: 9 });
        const result = await fetchDiscussantForCase(9);
        expect(result.name).toBe('Discussant');
        expect(result.roleTitle).toBe('Case Debrief Tutor');
        expect(result.systemPrompt).toBe('');
        expect(result.contextFilter).toBe('full');
        expect(result.unlockTrigger).toBe('after_case_ended');
        expect(result.avatarUrl).toBeNull();
    });

    it('prefers name_override / system_prompt_override / context_filter_override when present', async () => {
        setCase(10, {
            id: 10,
            name: 'Base',
            name_override: 'Custom',
            system_prompt: 'base prompt',
            system_prompt_override: 'overridden prompt',
            context_filter: 'full',
            context_filter_override: 'minimal',
            agent_template_id: 555,
        });
        const result = await fetchDiscussantForCase(10);
        expect(result.name).toBe('Custom');
        expect(result.systemPrompt).toBe('overridden prompt');
        expect(result.contextFilter).toBe('minimal');
        expect(result.templateId).toBe(555);
    });
});

// ---------------------------------------------------------------------------
// buildCaseContext — filtered prompt-context generation
// ---------------------------------------------------------------------------

describe('buildCaseContext — filter-aware prompt context', () => {
    const fullCase = {
        name: 'Acute MI',
        config: {
            patient_name: 'Jane Doe',
            demographics: { age: 58, gender: 'F' },
            structuredHistory: {
                chiefComplaint: 'chest pain',
                historyOfPresentIllness: 'sudden onset 1h ago',
                pastMedicalHistory: 'HTN, T2DM',
                medications: 'lisinopril, metformin',
                allergies: 'NKDA',
            },
            initial_vitals: { hr: 110, bpSys: 90, bpDia: 60, spo2: 92, rr: 22, temp: 37.1 },
            diagnosis: 'STEMI',
            treatment_plan: 'ASA, heparin, cath lab',
            learning_objectives: ['recognize STEMI', 'order labs'],
        },
    };

    it('returns empty string when activeCase is null', () => {
        // CONTRACT: missing case -> no context block at all (caller's
        // system prompt stays clean).
        expect(buildCaseContext(null, 'full')).toBe('');
        expect(buildCaseContext(undefined, 'full')).toBe('');
    });

    it('returns empty string when contextFilter === "minimal" (Socratic mode)', () => {
        // CONTRACT: minimal mode is the Socratic / spoiler-free mode; the
        // discussant gets nothing, must ask the learner instead.
        expect(buildCaseContext(fullCase, 'minimal')).toBe('');
    });

    it('full filter includes diagnosis, treatment plan, and learning objectives', () => {
        const out = buildCaseContext(fullCase, 'full');
        expect(out).toContain('Expected diagnosis: STEMI');
        expect(out).toContain('Expected treatment plan: ASA, heparin, cath lab');
        expect(out).toContain('Learning objectives: recognize STEMI; order labs');
        expect(out).toContain('Current Medications: lisinopril, metformin');
        expect(out).toContain('Allergies: NKDA');
    });

    it('history filter includes HPI/PMH but strips diagnosis and vitals', () => {
        // CONTRACT: 'history' is for cases where the discussant should
        // reason from the story, not the diagnosis or vitals.
        const out = buildCaseContext(fullCase, 'history');
        expect(out).toContain('History of Present Illness: sudden onset 1h ago');
        expect(out).toContain('Past Medical History: HTN, T2DM');
        expect(out).not.toContain('Expected diagnosis');
        expect(out).not.toContain('Initial vitals');
        expect(out).not.toContain('Pre-admission meds');
    });

    it('vitals filter includes initial vitals but strips HPI and diagnosis', () => {
        const out = buildCaseContext(fullCase, 'vitals');
        expect(out).toContain('Initial Vitals');
        expect(out).toContain('HR: 110 bpm');
        expect(out).toContain('BP: 90/60');
        expect(out).toContain('SpO2: 92%');
        expect(out).not.toContain('HPI:');
        expect(out).not.toContain('Expected diagnosis');
    });

    it('always includes case name + chief complaint (the safe baseline)', () => {
        // CONTRACT: any non-minimal filter at minimum identifies the case
        // and the chief complaint — the discussant needs SOMETHING to
        // anchor the conversation.
        const out = buildCaseContext(fullCase, 'history');
        expect(out).toContain('Case: Acute MI');
        expect(out).toContain('Patient: Jane Doe');
        expect(out).toContain('Age: 58');
        expect(out).toContain('Chief Complaint: chest pain');
    });

    it('emits the spoiler-guard footer reminding the discussant to ask the learner', () => {
        // CONTRACT: the trailing note is what stops the discussant from
        // hallucinating that the learner did orders/exams. It MUST appear
        // whenever any context is emitted.
        const out = buildCaseContext(fullCase, 'full');
        expect(out).toContain('=== CASE CONTEXT ===');
        expect(out).toContain('=== END CONTEXT ===');
        expect(out).toContain("ask the learner");
    });

    it('returns empty string for an empty case (no name, no config) at full filter', () => {
        // CONTRACT: when there's literally nothing to say (no name and no
        // config fields), the function returns ''. The internal `parts`
        // array still gets a default "Case: Unnamed" line — so this also
        // doubles as a regression check on that summary line.
        const minimalCase = { config: {} };
        const out = buildCaseContext(minimalCase, 'full');
        // The summary line is always pushed, so parts.length is never 0
        // when filter !== 'minimal'. The output WILL have a context block,
        // but only the "Case: Unnamed" line.
        expect(out).toContain('Case: Unnamed');
        expect(out).not.toContain('Chief complaint');
        expect(out).not.toContain('Initial vitals');
        expect(out).not.toContain('Expected diagnosis');
    });

    it('handles learning_objectives when stored as a plain string (legacy shape)', () => {
        // CONTRACT: older cases store learning_objectives as a string;
        // newer ones use an array. Both must format cleanly.
        const legacy = {
            name: 'Old Case',
            config: { learning_objectives: 'memorize the algorithm' },
        };
        const out = buildCaseContext(legacy, 'full');
        expect(out).toContain('Learning objectives: memorize the algorithm');
    });
});
