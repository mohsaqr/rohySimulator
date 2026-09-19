// Core-tier cases the gate was blocked on, automated at the contract layer.
//
// Prova's release gate lists 40 core cases with no counting pass. Eleven are
// `kind: both` — already automated, waiting on their HUMAN half — so no test
// can help them. Of the 29 that are `manual` with no automation at all, these
// six are decidable by a machine WITHOUT judgement: each one's whole expected
// outcome is a server contract, not something a person has to look at and form
// an opinion about.
//
// They are driven through the API rather than the UI, following the convention
// `case-lifecycle.spec.js` states outright — "the Start affordance varies by
// build; rather than guess at a selector, hit the API path the UI would call".
// The learner-facing chrome for these (a worklist row, a room button, a
// summary panel) has no stable hook today; the contract underneath it does,
// and the contract is what the case's `expected` actually describes.
//
// WHAT IS DELIBERATELY NOT HERE. Anything needing a person: whether the
// patient stays in character, whether a debrief asks rather than lectures,
// whether a rhythm change is visible in the trace. Automating those would mean
// asserting something weaker than the case and then marking it covered, which
// is worse for the gate than leaving it honestly manual.

import { test, expect, findCase, waitForSeed } from './fixtures/index.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

const RUN_TAG = `e2e-gate-${Date.now()}`;

// One admin token for the spec: each loginAs is a real login and the server
// caps 10 per 15 minutes per IP.
let _ctx;
async function api(baseURL) {
    if (!_ctx) {
        const { token } = await loginAs(baseURL, 'admin');
        _ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    }
    return _ctx;
}

let caseId;
let sessionId;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    const seeded = await findCase(baseURL, (c) => c.is_default === 1) || await findCase(baseURL, () => true);
    expect(seeded, 'a seeded case to run against').toBeTruthy();
    caseId = seeded.id;

    const ctx = await api(baseURL);
    const res = await ctx.post('/api/sessions', { data: { case_id: caseId, student_name: `${RUN_TAG}-learner` } });
    expect(res.ok(), await res.text()).toBeTruthy();
    sessionId = (await res.json()).id;
});

test.afterAll(async () => {
    if (_ctx) await _ctx.dispose();
    _ctx = null;
});

// ---------------------------------------------------------------------------

test.describe('orders honour what the learner asked for', () => {
    // CASE.LABS.03 ("Order instantly skips the wait") is NOT automated here,
    // deliberately. Measured on this build: ordering the same default-catalogue
    // lab with `turnaround_override: 0` and with `turnaround_override: 5`
    // produces an IDENTICAL `available_at`, and the catalogue advertises
    // `turnaround_minutes: 1` for a test it makes available immediately. With
    // every default lab already instant there is nothing for "instantly" to
    // skip, so any assertion here would pass without testing the case. Filed as
    // a defect; the case stays manual until the override is honoured.

    // CASE.TREAT.03 — "A treatment can be stopped"
    test('a treatment can be discontinued, and the order says so afterwards', async ({ baseURL }) => {
        const ctx = await api(baseURL);
        // Without ?type the catalogue comes back GROUPED by type, not as a
        // flat array — `.length` on it is undefined, not zero.
        const avail = await (await ctx.get(`/api/sessions/${sessionId}/available-treatments`)).json();
        const grouped = avail.treatments || {};
        const pool = Array.isArray(grouped) ? grouped : Object.values(grouped).flat();
        expect(pool.length, 'the catalogue offers treatments').toBeGreaterThan(0);

        // The route identifies a treatment by type AND name, not by id — it
        // refuses with 400 "treatment_type and treatment_name are required".
        const pick = pool.find((t) => t.treatment_type && t.treatment_name) || pool[0];
        const ordered = await ctx.post(`/api/sessions/${sessionId}/order-treatment`, {
            data: {
                treatment_type: pick.treatment_type,
                treatment_name: pick.treatment_name,
                dose: pick.dose ?? null,
                route: pick.route ?? null,
            },
        });
        expect(ordered.ok(), await ordered.text()).toBeTruthy();
        const body = await ordered.json();
        let orderId = body.id ?? body.order_id ?? body.order?.id;
        if (!orderId) {
            const list = (await (await ctx.get(`/api/sessions/${sessionId}/treatment-orders`)).json()).orders || [];
            orderId = list.at(-1)?.id;
        }
        expect(orderId, 'the order came back with an id').toBeTruthy();

        const stopped = await ctx.put(`/api/sessions/${sessionId}/discontinue/${orderId}`);
        expect(stopped.ok(), await stopped.text()).toBeTruthy();

        const orders = await (await ctx.get(`/api/sessions/${sessionId}/treatment-orders`)).json();
        const row = (orders.orders || []).find((o) => String(o.id) === String(orderId));
        expect(row, 'the discontinued order is still listed — stopping is not deleting').toBeTruthy();
        expect(row.status).toBe('discontinued');
        expect(row.discontinued_at, 'the stop is timestamped, so its effect can stop growing').toBeTruthy();
    });

    // CASE.IMAGING.02 — "Ordering imaging opens the PACS room"
    test('an imaging order is what makes a study exist for the PACS room', async ({ baseURL }) => {
        const ctx = await api(baseURL);
        const before = await (await ctx.get(`/api/sessions/${sessionId}/radiology-orders`)).json();
        const countBefore = (before.orders || before.radiology || []).length;

        const avail = await (await ctx.get(`/api/sessions/${sessionId}/available-radiology`)).json();
        const pool = avail.radiology || avail.available || avail.studies || [];
        expect(pool.length, 'the catalogue offers imaging').toBeGreaterThan(0);

        const ordered = await ctx.post(`/api/sessions/${sessionId}/order-radiology`, {
            data: { radiology_ids: [pool[0].id], turnaround_override: 0 },
        });
        expect(ordered.ok(), await ordered.text()).toBeTruthy();

        const after = await (await ctx.get(`/api/sessions/${sessionId}/radiology-orders`)).json();
        const rows = after.orders || after.radiology || [];
        expect(rows.length, 'the order is on the session').toBeGreaterThan(countBefore);
        // The room bar derives PACS availability from studies existing on the
        // session. This asserts the data the bar reads, not the bar itself.
        expect(rows.some((r) => r.study_name || r.modality || r.radiology_id), 'the study is identifiable').toBe(true);
    });
});

test.describe('the debrief tells the truth about the session', () => {
    // DEBRIEF.REVIEW.01 — "The case summary reflects what this learner did"
    test('the record holds exactly what was done, with nothing invented', async ({ baseURL }) => {
        const ctx = await api(baseURL);
        // A session of its own so the counts are exact.
        const s = await ctx.post('/api/sessions', { data: { case_id: caseId, student_name: `${RUN_TAG}-exact` } });
        const sid = (await s.json()).id;

        const one = `${RUN_TAG}-troponin`;
        const sync = await ctx.post('/api/patient-record/sync', {
            data: {
                session_id: sid, record_id: `${RUN_TAG}-rec`,
                events: [
                    { id: `${RUN_TAG}-e1`, verb: 'ORDERED', time: 3, category: 'lab', item: one, content: one },
                    { id: `${RUN_TAG}-e2`, verb: 'EXAMINED', time: 5, category: 'exam', region: 'chest', item: 'auscultation' },
                ],
                patient_info: { name: 'Exactness Test' }, current_state: {}, events_count: 2, document: {},
            },
        });
        expect(sync.ok(), await sync.text()).toBeTruthy();

        // NOT /sessions/:id/patient-record — that path does not exist and the
        // SPA fallback answers it with index.html, so the failure arrives as
        // "Unexpected token '<'" rather than a 404.
        const recRes = await ctx.get(`/api/patient-record/${sid}/events`);
        expect(recRes.ok(), await recRes.text()).toBeTruthy();
        const rec = await recRes.json();
        const events = rec.events || [];
        expect(events.length, 'exactly what was done — no more').toBe(2);
        expect(events.map((e) => e.verb).sort()).toEqual(['EXAMINED', 'ORDERED']);
        expect(events.some((e) => (e.item || e.content || '').includes(one)), 'the lab that was ordered is named').toBe(true);
    });

    // DEBRIEF.DISCUSS.04 — "A case with no discussant says so plainly"
    test('a case with no discussant resolves to none rather than hanging', async ({ baseURL }) => {
        const ctx = await api(baseURL);
        const made = await ctx.post('/api/cases', {
            data: { name: `${RUN_TAG} no discussant`, description: 'gate-core fixture', system_prompt: 'You are the patient.', config: {} },
        });
        expect(made.ok(), await made.text()).toBeTruthy();
        const bare = (await made.json()).id;

        const agents = await ctx.get(`/api/cases/${bare}/agents`);
        expect(agents.ok()).toBeTruthy();
        const list = (await agents.json()).agents || [];
        // The endpoint must ANSWER — an empty list is the "no discussant"
        // signal the debrief renders its message from. A 404 or a hang is what
        // leaves the room on an empty loading state.
        expect(Array.isArray(list)).toBe(true);
        expect(list.some((a) => a.agent_type === 'discussant'), 'no discussant on this case').toBe(false);
    });
});

test.describe('a case carries its own language', () => {
    // I18N.CASE.01 — "The case's language is independent of the interface language"
    test('each case advertises its own language, whatever the interface is set to', async ({ baseURL }) => {
        const ctx = await api(baseURL);
        const cases = (await (await ctx.get('/api/cases')).json()).cases || [];
        expect(cases.length).toBeGreaterThan(1);

        // The language a case advertises is the prefix of its case code
        // (EN-0001, DE-0007): one field, set when the case is created and
        // immutable after. There is no `case_language` column — the language
        // is carried BY the code, which is what the list renders its flag from.
        const coded = cases.filter((c) => /^[A-Z]{2}-\d+/.test(c.case_code || ''));
        expect(coded.length, 'cases carry a language-prefixed code').toBeGreaterThan(0);

        // The seeded catalogue is natively multilingual, so more than one
        // language must be present — otherwise "independent of the interface"
        // is untested whatever the interface says. The interface language of
        // this request is English throughout; the codes are unaffected by it.
        const languages = new Set(coded.map((c) => c.case_code.slice(0, 2)));
        expect(languages.size, `more than one case language is seeded (saw ${[...languages].join(', ')})`).toBeGreaterThan(1);
    });
});
