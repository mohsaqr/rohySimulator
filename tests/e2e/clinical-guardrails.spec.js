// The two teaching guardrails a machine CAN judge, automated so they are
// checked on every build instead of once per manual sweep.
//
// Both encode rules this project has had to defend more than once:
//
// 1. The answer key never leaves the server while the case is live.
//    The consultant room is reachable MID-session (visiting it deliberately
//    does not end the case), so `treatment-debrief` must withhold the
//    "expected but not ordered" list until the session has actually ended.
//    Shipping it early hands the learner the answer through the network tab.
//    Contract: `pending: true` and an empty `missed` while live; `pending:
//    false` once ended.
//
// 2. The investigation catalogues stay FULL.
//    Narrowing the orderable list to what the case authored tells the learner
//    which tests matter — the diagnosis by elimination. "Unadded tests still
//    show" has been filed as a bug twice and is invalid both times: hiding an
//    investigation is always an explicit, per-case educator act.
//
// These back DEBRIEF.REVIEW.02, CASE.LABS.02 and AUTHOR.VISIBILITY.01 in
// prova/rohy-cases.yaml, which name these titles in their `covers:` patterns.
// Renaming a test here breaks that link — prova/check-coverage-links.mjs will
// say so.

import { test, expect, findCase, waitForSeed } from './fixtures/index.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';

const RUN_TAG = `e2e-guard-${Date.now()}`;

let _ctx = null;
async function adminCtx(baseURL) {
    if (!_ctx) {
        const { token } = await loginAs(baseURL, 'admin');
        _ctx = await pwRequest.newContext({
            baseURL,
            extraHTTPHeaders: { Authorization: `Bearer ${token}` },
        });
    }
    return _ctx;
}

async function startSession(baseURL, caseId, tag) {
    const ctx = await adminCtx(baseURL);
    const res = await ctx.post('/api/sessions', {
        data: {
            case_id: caseId,
            student_name: `${RUN_TAG}-${tag}`,
            llm_settings: {},
            monitor_settings: {},
        },
    });
    if (!res.ok()) throw new Error(`POST /api/sessions failed (${res.status()}): ${await res.text()}`);
    return res.json();
}

test.describe('clinical guardrails', () => {
    let theCase = null;

    test.beforeAll(async ({ baseURL }) => {
        await waitForSeed(baseURL);
        theCase = await findCase(baseURL, () => true);
        if (!theCase) throw new Error('No seeded cases — the server seeder is broken.');
    });

    test('the answer key is withheld while the case is live and released when it ends', async ({ baseURL }) => {
        const ctx = await adminCtx(baseURL);
        const session = await startSession(baseURL, theCase.id, 'answer-key');

        const live = await ctx.get(`/api/sessions/${session.id}/treatment-debrief`);
        expect(live.status()).toBe(200);
        const whileLive = await live.json();

        // The gate itself, and the payload it guards. `missed` names the
        // un-ordered expected treatments — the answer.
        expect(whileLive.pending, 'the debrief is not marked pending while the session is live').toBe(true);
        expect(whileLive.missed, 'the missed-treatment answer key leaked mid-session').toEqual([]);

        const ended = await ctx.put(`/api/sessions/${session.id}/end`, { data: {} });
        expect(ended.ok()).toBeTruthy();

        const after = await ctx.get(`/api/sessions/${session.id}/treatment-debrief`);
        expect(after.status()).toBe(200);
        const afterEnd = await after.json();

        // Released — the learner has finished, so the teaching payload is due.
        expect(afterEnd.pending, 'the debrief is still pending after the session ended').toBe(false);
        expect(Array.isArray(afterEnd.missed)).toBe(true);
        expect(typeof afterEnd.total_points).toBe('number');
    });

    test('the laboratory catalogue stays full, whatever the case expects', async ({ baseURL }) => {
        const ctx = await adminCtx(baseURL);

        const groupsRes = await ctx.get('/api/labs/groups');
        expect(groupsRes.status()).toBe(200);
        const { groups } = await groupsRes.json();

        // A narrowed catalogue collapses to the handful of groups the case
        // authored. The real master list spans the whole of laboratory
        // medicine, so a low number here is the tell.
        expect(Array.isArray(groups)).toBe(true);
        expect(groups.length, `only ${groups.length} lab groups offered — the catalogue looks narrowed to the case`)
            .toBeGreaterThan(10);

        // Tests with no bearing on a chest-pain case must still be orderable.
        // If these disappear, the orderable list is telling the learner which
        // tests matter.
        for (const term of ['glucose', 'thyroid', 'vitamin']) {
            const res = await ctx.get(`/api/labs/search?q=${term}`);
            expect(res.status()).toBe(200);
            const found = (await res.json()).results.flat();
            expect(found.length, `"${term}" is not orderable — the catalogue has been narrowed`).toBeGreaterThan(0);
            expect(typeof found[0].test_name).toBe('string');
        }
    });

    test('the radiology catalogue stays full too', async ({ baseURL }) => {
        const ctx = await adminCtx(baseURL);
        const res = await ctx.get('/api/radiology-database');
        expect(res.status()).toBe(200);

        const body = await res.json();
        const studies = Array.isArray(body) ? body : (body.studies ?? body.results ?? body.tests ?? []);
        expect(Array.isArray(studies)).toBe(true);
        expect(studies.length, `only ${studies.length} radiology studies offered — the catalogue looks narrowed`)
            .toBeGreaterThan(10);
    });

    test('an unauthenticated caller cannot read a case debrief', async ({ request, baseURL }) => {
        const session = await startSession(baseURL, theCase.id, 'anon');
        const res = await request.get(`/api/sessions/${session.id}/treatment-debrief`);
        expect(res.ok()).toBe(false);
        expect([401, 403]).toContain(res.status());
    });
});
