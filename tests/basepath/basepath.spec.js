// Rohy served under /rohy/ (playwright.basepath.config.js): a learner walks
// every room of a case, the pathology slide included, and no request may
// leave the base path. Every slide 404'd on an install served at /rohy/ until
// rc.44, because the slide addresses were written as '/api/plugins/…'; the
// main suite, served at '/', could not see it.

import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BASEPATH_LIBRARY, BASEPATH_SERVER } from '../../playwright.basepath.config.js';

const LIB_ASSET = 'asset-ba5e0a7b5e0a7b5e0a7b5e0a';   // asset-<24 hex>
const BASE = '/rohy/';

let admin;
let student;
let theCase;

/** A one-slide deep-zoom pyramid in the library: 256 px square, levels 0–8. */
async function writeLibrarySlide() {
    const root = path.join(BASEPATH_LIBRARY, LIB_ASSET);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'slide.dzi'),
        '<?xml version="1.0" encoding="UTF-8"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpeg" Overlap="0" TileSize="256"><Size Width="256" Height="256"/></Image>');
    const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#e8c4d0' } }).jpeg().toBuffer();
    for (let level = 0; level <= 8; level++) {
        fs.mkdirSync(path.join(root, 'slide_files', String(level)), { recursive: true });
        fs.writeFileSync(path.join(root, 'slide_files', String(level), '0_0.jpeg'), tile);
    }
}

/** The smallest pathology case document the room accepts: one specimen, one slide. */
function pathologyCase() {
    return {
        manifest: {
            $schema: 'https://pathoyon.org/schemas/pathology-case-1.0.schema.json',
            schemaVersion: '1.0.0',
            id: 'case-basepath-001',
            revision: { id: 'revision-basepath-001', number: 1, status: 'draft', parentRevisionId: null, createdAt: '2026-10-12T00:00:00.000Z', createdBy: 'e2e' },
            title: 'Base path specimen',
            clinical: { accession: 'E2E-BP-1', specimenSummary: 'A: test specimen', history: 'A test case.' },
            specimens: [{ id: 'specimen-bp', part: 'A', label: 'Test specimen', description: 'A test specimen.', grossImageAssetIds: [] }],
            blocks: [{ id: 'block-bp', specimenId: 'specimen-bp', label: 'A1', description: 'Test block' }],
            assets: [{
                id: 'asset-bp-wsi', kind: 'wsi',
                source: { kind: 'catalog', catalogAssetId: LIB_ASSET, revision: 'managed' },
                metadata: { widthPx: 256, heightPx: 256, nativeObjective: 40, nativeMpp: 0.25, downsample: 1 },
                renditions: [{ kind: 'dzi', uri: `remote:library/${LIB_ASSET}/slide.dzi` }],
            }],
            slides: [{ id: 'slide-bp', blockId: 'block-bp', assetId: 'asset-bp-wsi', label: 'A1 — HE', stain: { code: '', display: '' } }],
            activities: [{ id: 'activity-bp', kind: 'report', prompt: 'Examine the slide.', instructions: 'Look at the whole slide.' }],
            provenance: { authoredWith: 'e2e' },
        },
    };
}

async function login(username, password) {
    const ctx = await pwRequest.newContext({ baseURL: BASEPATH_SERVER });
    const res = await ctx.post('/api/auth/login', { data: { username, password } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { token } = await res.json();
    await ctx.dispose();
    return { token, ctx: await pwRequest.newContext({ baseURL: BASEPATH_SERVER, extraHTTPHeaders: { Authorization: `Bearer ${token}` } }) };
}

test.beforeAll(async () => {
    await writeLibrarySlide();
    ({ ctx: admin } = await login('admin', 'admin123'));
    ({ ctx: student } = await login('student', 'student123'));
    // Past the student's first-run page, as the main suite's globalSetup does.
    const pref = await student.put('/api/users/preferences', { data: { onboarding_settings: { first_run_done: 1, oyon_consent: false } } });
    expect(pref.ok(), await pref.text()).toBeTruthy();

    const made = await admin.post('/api/cases', { data: {
        name: 'Base path case', description: 'served under /rohy/', system_prompt: 'You are a patient.',
        config: { patient_name: 'Base Path', demographics: { age: 60, gender: 'Male' }, pathology: pathologyCase() },
    } });
    expect(made.ok(), await made.text()).toBeTruthy();
    theCase = await made.json();
    await admin.put(`/api/cases/${theCase.id}/availability`, { data: { is_available: true } });
    const cohortId = (await (await admin.post('/api/cohorts', { data: { name: 'Base path course' } })).json()).cohort.id;
    await admin.post(`/api/cohorts/${cohortId}/members`, { data: { identifier: 'student' } });
    await admin.post(`/api/cohorts/${cohortId}/cases`, { data: { case_ids: [theCase.id] } });
});

test.afterAll(async () => {
    await admin?.dispose();
    await student?.dispose();
});

test('under a base path, every room and the pathology slide load without leaving it', async ({ page }) => {
    // Every same-origin request the page makes, and any answered with an error.
    const origin = 'http://127.0.0.1:4832';
    const outside = [];
    const failed = [];
    page.on('request', (req) => {
        // blob:/data: are in-memory objects, not addresses on the server.
        if (!/^https?:/.test(req.url())) return;
        const url = new URL(req.url());
        if (url.origin === origin && !url.pathname.startsWith(BASE)) outside.push(`${req.method()} ${url.pathname}`);
    });
    page.on('response', (res) => {
        if (!/^https?:/.test(res.url())) return;
        const url = new URL(res.url());
        // Only what must exist: the app's own build, Oyon's files and plugin
        // content. An API 404 can be an answer ("no record yet"), and the
        // body map probes for an uploaded silhouette before its default.
        const mustExist = /^\/rohy\/(assets|oyon|api\/plugins)\//.test(url.pathname);
        if (url.origin === origin && mustExist && res.status() >= 400) failed.push(`${res.status()} ${url.pathname}`);
    });

    const made = await student.post('/api/sessions', { data: { case_id: theCase.id, student_name: 'basepath' } });
    expect(made.ok(), await made.text()).toBeTruthy();
    const sessionId = (await made.json()).id;
    // Signed in the way a learner is: through the proxy, so the session
    // cookie lands on this origin. The slide viewer's tile requests carry the
    // cookie and nothing else — a bearer token in localStorage would not
    // reach them.
    const signedIn = await page.request.post('api/auth/login', { data: { username: 'student', password: 'student123' } });
    expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
    await page.addInitScript(([session, caseId]) => {
        for (const role of ['admin', 'educator', 'student']) window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
        window.localStorage.setItem('rohy_active_session', JSON.stringify({ caseId, sessionId: session, timestamp: Date.now() }));
    }, [sessionId, theCase.id]);

    await page.goto('');
    await expect(page.getByTestId('room-navigator')).toBeVisible({ timeout: 30_000 });

    const keys = await page.locator('[data-testid^="room-button-"]')
        .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('room-button-', '')));
    expect(keys, 'the case offers its pathology room').toContain('pathology');
    for (const key of keys.filter((k) => k !== 'pathology')) {
        const btn = page.getByTestId(`room-button-${key}`);
        const box = await btn.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(btn).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(1_000);
    }

    // The slide: its descriptor is fetched under the base path, and found.
    // A learner's slide reference arrives sealed (rc.89, lib/pluginOpaqueRefs.js):
    // `…/pathology/_o/<token>.dzi` instead of `…/library/<id>/slide.dzi`.
    const slide = page.waitForResponse((res) => /\.dzi(\?|$)/.test(new URL(res.url()).pathname), { timeout: 60_000 });
    const btn = page.getByTestId('room-button-pathology');
    const box = await btn.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const opener = page.getByText('A1 — HE').first();
    if (await opener.isVisible().catch(() => false)) await opener.click().catch(() => {});
    const dzi = await slide;
    const dziPath = new URL(dzi.url()).pathname;
    expect(dziPath, 'the slide is requested under the base path')
        .toMatch(new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}api/plugins/pathology/_o/[^/]+\\.dzi$`));
    expect(dziPath, 'the learner never sees the library id').not.toContain(LIB_ASSET);
    expect(dzi.status(), 'and found').toBe(200);
    await page.waitForTimeout(2_000);

    // Nothing left the base path, and nothing the app asked for was missing.
    expect(outside, 'requests that ignored the base path').toEqual([]);
    expect(failed, 'app files, Oyon files or plugin content that failed to load').toEqual([]);
});
