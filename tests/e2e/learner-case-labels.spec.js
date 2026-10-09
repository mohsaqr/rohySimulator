// PRV-21: exercise the real case selector and room adapters with unique
// diagnosis-bearing authoring fields, rather than passing already safe props.
import { test, expect, apiAsAdmin, waitForSeed } from './fixtures/index.js';
import {
    createAssignedCase, enterLiveCase, disposeLearnerApi, learnerApi, room,
} from './fixtures/liveCase.js';
import { STEMI_V2_CASE } from '../../server/seeders/stemiV2.js';

const TAG = `prv21-${Date.now()}`;
const TITLE = `${TAG} AUTHORING-DIAGNOSIS-Anterior-STEMI`;
const SUMMARY = `${TAG} AUTHORING-SUMMARY-Proximal-LAD-occlusion`;
const PATIENT = `${TAG} Alex Example`;
const COMPLAINT = 'Chest discomfort for forty minutes';
let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    const config = JSON.parse(STEMI_V2_CASE.config);
    config.patient_name = PATIENT;
    config.structuredHistory = { chiefComplaint: COMPLAINT };
    config.rooms = { disabled: ['room3d'] };
    // The production STEMI echo deliberately has no images. Give this fixture
    // an authored normal chest study so the real PACS availability gate opens.
    config.pacs = {
        version: 1,
        worklist: [{
            id: `${TAG}-chest`, studyId: 'xray_chest_portable',
            description: 'Chest radiograph', availableAtMinutes: 0,
            baseline: { kind: 'archive', ref: 'normal/xr_chest' },
            substitutions: [], report: { released: true, findings: 'Normal chest radiograph.' },
        }],
    };
    // The helper names its course after the case. Keep that unrelated course
    // label neutral; this regression targets the case's authoring fields.
    theCase = await createAssignedCase(baseURL, { name: `${TAG} clinical exercise`, config });
    const admin = await apiAsAdmin(baseURL);
    try {
        const updated = await admin.put(`/api/cases/${theCase.id}`, {
            data: { ...theCase, name: TITLE, description: SUMMARY, config },
        });
        expect(updated.ok(), await updated.text()).toBeTruthy();
        const stored = await (await admin.get(`/api/cases/${theCase.id}`)).json();
        expect(stored.name).toBe(TITLE);
        expect(stored.description).toBe(SUMMARY);
    } finally { await admin.dispose(); }
});
test.afterAll(disposeLearnerApi);

async function expectNoAuthoringLabels(page, surface) {
    await expect(page.locator('body'), surface).not.toContainText(TITLE);
    await expect(page.locator('body'), surface).not.toContainText(SUMMARY);
}

test.describe('learner case labels (PRV-21)', () => {
    test('the selector shows patient identity and complaint without authoring title or summary', async ({ studentPage }) => {
        await studentPage.addInitScript(() => {
            localStorage.setItem('rohy_view', JSON.stringify({ view: 'settings' }));
        });
        await studentPage.goto('/');
        const sidebar = studentPage.locator('.rohy-admin-sidebar');
        await expect(sidebar).toBeVisible({ timeout: 20_000 });
        await sidebar.getByRole('button', { name: 'Select Case', exact: true }).click();
        await expect(studentPage.getByText(PATIENT, { exact: true })).toBeVisible();
        await expect(studentPage.getByText(COMPLAINT, { exact: true })).toBeVisible();
        await expectNoAuthoringLabels(studentPage, 'learner case selector');
    });

    test('core rooms, ECG and PACS headers, debrief and full summary keep the patient identity', async ({ page, baseURL }, testInfo) => {
        test.setTimeout(120_000);
        await enterLiveCase(page, baseURL, `${TAG}-rooms`, theCase);
        for (const key of ['chat', 'examination', 'lab', 'radiology', 'ecg', 'pacs']) {
            await expect(room(page, key), `${key} is offered by the synthetic case`).toBeVisible();
            await room(page, key).click();
            await expect(room(page, key)).toHaveAttribute('aria-pressed', 'true');
            await expect(page.getByText(PATIENT).first(), `${key} patient identity`).toBeVisible();
            await expectNoAuthoringLabels(page, `${key} room`);
            const screenshot = testInfo.outputPath(`${key}-learner-label.png`);
            await page.screenshot({ path: screenshot });
            await testInfo.attach(`${key} learner label`, { path: screenshot, contentType: 'image/png' });
        }
        await room(page, 'chat').click();
        await page.getByTestId('end-session').click();
        await page.getByTestId('end-session-confirm').click();
        await expect(room(page, 'consultant')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText(PATIENT, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(COMPLAINT, { exact: true })).toBeVisible();
        await expectNoAuthoringLabels(page, 'debrief patient card and header');
        await page.getByRole('button', { name: /View full case summary/i }).click();
        const summary = page.getByTestId('case-summary-modal');
        await expect(summary).toBeVisible();
        await expect(summary.getByRole('heading', { name: PATIENT, exact: true })).toBeVisible();
        await expect(summary).toContainText(COMPLAINT);
        await expectNoAuthoringLabels(page, 'full case summary');
        const screenshot = testInfo.outputPath('debrief-learner-label.png');
        await page.screenshot({ path: screenshot });
        await testInfo.attach('debrief learner label', { path: screenshot, contentType: 'image/png' });
    });

    test('learner case and session API responses omit authoring title and summary', async ({ baseURL }) => {
        const api = await learnerApi(baseURL);
        const started = await api.post('/api/sessions', { data: { case_id: theCase.id, student_name: `${TAG}-api` } });
        expect(started.ok(), await started.text()).toBeTruthy();
        const sessionId = (await started.json()).id;
        for (const path of ['/api/cases', `/api/cases/${theCase.id}`, `/api/sessions/${sessionId}`, '/api/analytics/sessions', `/api/analytics/sessions/${sessionId}`]) {
            const response = await api.get(path);
            expect(response.status(), path).toBe(200);
            const text = await response.text();
            expect(text, path).not.toContain(TITLE);
            expect(text, path).not.toContain(SUMMARY);
        }
    });
});
