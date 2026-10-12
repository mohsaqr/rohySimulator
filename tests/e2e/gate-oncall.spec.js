// The on-call phone as the learner meets it: where it sits in every room, at
// desktop and tablet width, and which specialists a case puts on it.

import { test, expect, waitForSeed, apiAsAdmin } from './fixtures/index.js';
import { createAssignedCase, enterLiveCase, disposeLearnerApi, room } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-gate-oncall-${Date.now()}`;
const PATIENT = { patient_name: 'Phone Example', demographics: { age: 50, gender: 'Male' } };

let bedsideCase;     // every room, the bedside included
let slidesCase;      // pathology slides → a pathologist
let ecgCase;         // an ECG record → a cardiologist
let plainCase;       // neither

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    bedsideCase = await createAssignedCase(baseURL, {
        name: `${RUN_TAG} bedside`, config: { ...PATIENT, rooms: { enabled: ['room3d'] } },
    });
    // Saved through POST /cases — the same save the case editor makes, which
    // is where a standing specialist is attached.
    slidesCase = await createAssignedCase(baseURL, {
        name: `${RUN_TAG} slides`,
        config: { ...PATIENT, pathology: { slides: [{ id: 's1', label: 'A1 — HE', dzi: 'remote:tiles/starter.dzi' }] } },
    });
    ecgCase = await createAssignedCase(baseURL, {
        name: `${RUN_TAG} ecg`,
        config: { ...PATIENT, ecg: { recordings: [{ id: 'r1', label: '12-lead at arrival' }] } },
    });
    plainCase = await createAssignedCase(baseURL, { name: `${RUN_TAG} plain`, config: { ...PATIENT } });
});

test.afterAll(disposeLearnerApi);

const phoneButton = (page) => page.getByTestId('oncall-phone-button');
const handset = (page) => page.getByTestId('oncall-phone');

/** A real pointer press at the centre of `locator`, through hit-testing. */
async function pressAtCentre(page, locator, what) {
    const box = await locator.boundingBox({ timeout: 30_000 });
    expect(box, `${what} has a box on screen`).not.toBeNull();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Where the phone sits, and what it overlaps: every visible control, trace,
 * vital sign and the session clock whose box intersects the phone's, other
 * than the phone itself and what contains it.
 */
function phoneLayout(page) {
    return page.evaluate(() => {
        const phone = document.querySelector('[data-testid="oncall-phone-button"]');
        const p = phone.getBoundingClientRect();
        const near = (sel) => {
            const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        const selector = 'button, a[href], input, select, textarea, canvas, [data-testid^="vital-"], [data-testid="session-clock"], [data-testid="end-session"], [role="switch"]';
        // A canvas that fills most of the window is a room's backdrop (the 3D
        // bedside scene), drawn under the room's own controls — not a trace.
        const backdrop = (el, r) => el.tagName === 'CANVAS' && r.width * r.height > 0.5 * innerWidth * innerHeight;
        const covered = [];
        for (const el of document.querySelectorAll(selector)) {
            if (el === phone || el.contains(phone) || phone.contains(el)) continue;
            // Under the bedside overlay the chat layout stays mounted but
            // inert and covered — not something the phone can hide.
            if (el.closest('[inert]')) continue;
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || st.display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || backdrop(el, r)) continue;
            const overlap = Math.min(r.right, p.right) - Math.max(r.left, p.left) > 1
                && Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) > 1;
            if (overlap) covered.push(`${el.tagName}${el.dataset.testid ? `[${el.dataset.testid}]` : ''} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 25)}" ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)} in ${el.parentElement?.className?.toString().slice(0, 40)}`);
        }
        return {
            phone: { top: p.top, bottom: p.bottom, left: p.left, right: p.right },
            logout: near('[data-testid="logout"]'),
            ready: near('[data-testid="oyon-capture-dock"]'),
            covered,
        };
    });
}

// ---------------------------------------------------------------------------

test.describe('where the phone sits', () => {
    // ONCALL.PHONE.03
    test('in every room the phone sits in the top bar and covers nothing, at desktop and tablet width', async ({ page, baseURL }) => {
        test.setTimeout(180_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-layout`, bedsideCase);
        const keys = await page.locator('[data-testid^="room-button-"]')
            .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('room-button-', '')));
        expect(keys).toEqual(expect.arrayContaining(['chat', 'room3d', 'examination', 'lab', 'radiology', 'consultant']));

        for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 1024 }]) {
            await page.setViewportSize(viewport);
            for (const key of keys) {
                await pressAtCentre(page, room(page, key), `the ${key} room button`);
                await expect(room(page, key)).toHaveAttribute('aria-pressed', 'true');
                await expect(phoneButton(page), `one phone in ${key}`).toHaveCount(1);
                await expect(phoneButton(page)).toBeVisible();
                const at = `${key} at ${viewport.width}px`;
                const layout = await phoneLayout(page);

                // In the room's own top bar.
                expect(layout.phone.top, `${at}: the phone is in the top bar`).toBeLessThan(120);
                // Beside Logout, or beside the Ready pill over the bedside.
                const anchor = key === 'room3d' ? (layout.ready ?? layout.logout) : layout.logout;
                expect(anchor, `${at}: ${key === 'room3d' ? 'the Ready pill' : 'Logout'} is on screen`).not.toBeNull();
                const sameRow = Math.abs((anchor.top + anchor.bottom) / 2 - (layout.phone.top + layout.phone.bottom) / 2);
                expect(sameRow, `${at}: the phone is on the same row as its neighbour`).toBeLessThan(30);
                const gap = Math.min(Math.abs(layout.phone.left - anchor.right), Math.abs(anchor.left - layout.phone.right));
                expect(gap, `${at}: the phone is beside its neighbour`).toBeLessThan(120);

                // And it covers nothing.
                expect(layout.covered, `${at}: the phone covers`).toEqual([]);
            }
        }
    });
});

test.describe('who is on call', () => {
    /** The specialists the learner's phone lists for a case. */
    async function contacts(page, baseURL, theCase, tag) {
        await enterLiveCase(page, baseURL, `${RUN_TAG}-${tag}`, theCase);
        await pressAtCentre(page, phoneButton(page), 'the phone');
        await expect(handset(page)).toBeVisible();
        await expect(handset(page).getByTestId('oncall-contact-laboratorian')).toBeVisible({ timeout: 10_000 });
        return handset(page).locator('[data-testid^="oncall-contact-"]')
            .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('oncall-contact-', '')));
    }

    /** The case's agent list as the editor shows it, through the API it reads. */
    async function caseAgents(baseURL, caseId) {
        const admin = await apiAsAdmin(baseURL);
        try {
            const res = await admin.get(`/api/cases/${caseId}/agents`);
            expect(res.ok(), await res.text()).toBeTruthy();
            return (await res.json()).agents || [];
        } finally {
            await admin.dispose();
        }
    }

    // ONCALL.PHONE.04
    test('a case with slides has its pathologist, a case with an ECG its cardiologist, a plain case neither', async ({ browser, page, baseURL }) => {
        test.setTimeout(120_000);
        // The author's view: the pathologist is listed, always on call, with
        // no Remove button but still a switch to disable it.
        const editor = await browser.newContext({ baseURL });
        try {
            const admin = await apiAsAdmin(baseURL);
            const { token } = await (await admin.post('/api/auth/login', { data: { username: 'admin', password: 'admin123' } })).json();
            await admin.dispose();
            const authoring = await editor.newPage();
            await authoring.addInitScript((t) => {
                for (const role of ['admin', 'educator', 'student']) window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
                window.localStorage.removeItem('rohy_editing_case');
                window.localStorage.setItem('token', t);
            }, token);
            await authoring.goto('/');
            await authoring.getByTestId('topbar-menu').click();
            await authoring.getByTestId('menu-cases').click();
            await authoring.getByTestId(`case-edit-${slidesCase.id}`).click();
            await authoring.getByRole('button', { name: /Agents/i }).filter({ hasText: '🤖' }).first().click();
            const card = authoring.getByTestId('case-agent-pathologist');
            await expect(card, 'the pathologist is listed').toBeVisible({ timeout: 10_000 });
            await expect(card).toContainText('Always on call');
            await expect(card.getByRole('button', { name: 'Remove' }), 'no Remove button').toHaveCount(0);
            await expect(card.getByRole('button', { name: /Enabled|Disabled/ }), 'it can still be disabled').toHaveCount(1);
        } finally {
            await editor.close();
        }
        const standing = (agents, type) => agents.find((a) => a.agent_type === type);
        expect(standing(await caseAgents(baseURL, slidesCase.id), 'pathologist')?.standing).toBe(true);
        expect(standing(await caseAgents(baseURL, ecgCase.id), 'cardiologist')?.standing).toBe(true);

        // The learner's phone.
        const withSlides = await contacts(page, baseURL, slidesCase, 'slides');
        expect(withSlides, 'the pathologist beside the lab and radiology')
            .toEqual(expect.arrayContaining(['pathologist', 'laboratorian', 'radiologist']));
        expect(withSlides).not.toContain('cardiologist');

        const withEcg = await contacts(page, baseURL, ecgCase, 'ecg');
        expect(withEcg, 'the cardiologist beside the lab and radiology')
            .toEqual(expect.arrayContaining(['cardiologist', 'laboratorian', 'radiologist']));
        expect(withEcg).not.toContain('pathologist');

        const plain = await contacts(page, baseURL, plainCase, 'plain');
        expect(plain, 'a plain case lists neither').not.toContain('pathologist');
        expect(plain).not.toContain('cardiologist');
    });
});
