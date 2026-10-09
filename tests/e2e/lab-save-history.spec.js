// PRV-20: exercise the actual editor bulk-save endpoint against learner history.
// The test intentionally covers both finished and running sessions, and a
// catalogue lab the educator did not configure (created by learner ordering).
import { test, expect, apiAsAdmin, waitForSeed } from './fixtures/index.js';
import { createAssignedCase, learnerApi, disposeLearnerApi } from './fixtures/liveCase.js';

const authoredLab = {
    test_name: 'Hemoglobin', test_group: 'Hematology (CBC)', gender_category: 'General',
    min_value: 12, max_value: 18, current_value: 8, unit: 'g/dL',
    normal_samples: [], is_abnormal: true, turnaround_minutes: 0,
};

async function json(response) {
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
}

test.afterAll(disposeLearnerApi);

test.describe('case lab saves preserve learner history', () => {
    test('repeated saves and removing labs keep configured and unconfigured orders in running and ended sessions', async ({ baseURL }, testInfo) => {
        await waitForSeed(baseURL);
        const educator = await apiAsAdmin(baseURL);
        const learner = await learnerApi(baseURL);
        const sessions = [];
        let theCase;
        try {
            theCase = await createAssignedCase(baseURL, {
                name: `e2e-lab-history-${Date.now()}`,
                config: {
                    demographics: { name: 'History Patient', age: 40, gender: 'Male' },
                    investigations: { defaultLabsEnabled: true, instantResults: true },
                },
            });
            const save = async (labs) => json(await educator.put(`/api/cases/${theCase.id}/labs`, { data: { labs } }));
            await save([authoredLab]);

            // End the first session before creating the second, avoiding the
            // server's legitimate same-user/same-case active-session dedup.
            const makeSession = async (ended) => {
                const session = await json(await learner.post('/api/sessions', {
                    data: { case_id: theCase.id, student_name: 'History Student' },
                }));
                sessions.push(session.id);
                const catalog = await json(await learner.get(`/api/sessions/${session.id}/available-labs`));
                const configured = catalog.labs.find(lab => lab.test_name === authoredLab.test_name && typeof lab.id === 'number');
                const unconfigured = catalog.labs.find(lab => lab.source === 'default' && String(lab.id).startsWith('default_'));
                expect(configured, 'the authored lab exists').toBeTruthy();
                expect(unconfigured, 'a catalogue lab absent from the author list exists').toBeTruthy();
                const ordered = await json(await learner.post(`/api/sessions/${session.id}/order-labs`, {
                    data: { lab_ids: [configured.id, unconfigured.id], turnaround_override: 0 },
                }));
                expect(ordered.orders).toHaveLength(2);
                if (ended) await json(await learner.put(`/api/sessions/${session.id}/end`));
                return { id: session.id, ended, names: [configured.test_name, unconfigured.test_name].sort() };
            };
            const ended = await makeSession(true);
            const running = await makeSession(false);
            expect(running.id).not.toBe(ended.id);

            const history = async ({ id, names, ended: isEnded }) => {
                const detail = await json(await learner.get(`/api/sessions/${id}`));
                expect(Boolean(detail.session.end_time)).toBe(isEnded);
                const { orders } = await json(await learner.get(`/api/sessions/${id}/orders`));
                expect(orders.map(order => order.test_name).sort()).toEqual(names);
                const { results } = await json(await learner.get(`/api/sessions/${id}/lab-results`));
                expect(results.map(result => result.test_name).sort()).toEqual(names);
                return results.sort((a, b) => a.order_id - b.order_id);
            };
            const histories = await Promise.all([history(ended), history(running)]);
            // The UI can submit twice for Save/auto-save. Learner-created
            // catalogue rows are absent from this author payload by design.
            await save([authoredLab]);
            await save([authoredLab]);
            expect(await Promise.all([history(ended), history(running)])).toEqual(histories);

            // Even intentionally removing the authored lab preserves the
            // original order IDs, investigation IDs, values and ready results.
            await save([]);
            expect(await Promise.all([history(ended), history(running)])).toEqual(histories);
            await testInfo.attach('learner-lab-history-after-editor-saves', {
                body: Buffer.from(JSON.stringify({ case_id: theCase.id, sessions: [ended, running], histories }, null, 2)),
                contentType: 'application/json',
            });
        } finally {
            await Promise.all(sessions.map(id => learner.put(`/api/sessions/${id}/end`).catch(() => {})));
            if (theCase) await educator.delete(`/api/cases/${theCase.id}`);
            await educator.dispose();
        }
    });
});
