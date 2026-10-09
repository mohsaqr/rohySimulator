// Visit every settings surface before release. Screenshots are review artifacts;
// visible content, overflow, API responses and role gates are asserted separately.
import { test, expect, apiAsAdmin } from './fixtures/index.js';

const ADMIN_TABS = [
    'Overview', 'Cases', 'Scenarios', 'Agents', 'Avatars', 'Voice', 'Affect',
    'Users', 'Courses', 'Lessons', 'Analytics', 'Oyon', 'Logs', 'Body Map',
    'Lab Database', 'Medications', 'Treatments', 'Platform', 'Plugins', 'Notifications',
];
const LEARNER_TABS = ['Overview', 'Select Case', 'Oyon', 'Notifications'];
const SUB_SECTIONS = {
    Platform: ['General', 'AI / LLM', 'Users', 'Monitor'],
    Users: ['People', 'Invites', 'Requests'],
    Logs: ['Activity', 'Sessions', 'System Log', 'Chat Log', 'Moments', 'By Turn', 'Case Insights', 'Oyon data'],
    Analytics: ['Activity', 'Network', 'Patterns', 'Process Map', 'Clusters', 'Attention', 'Affect', 'Gaze', 'Text', 'Voice', 'Compare', 'Sessions', 'Settings'],
};

async function openSettings(page) {
    await page.addInitScript(() => {
        localStorage.setItem('rohy_view', JSON.stringify({ view: 'settings' }));
    });
    await page.goto('/');
    await expect(page.locator('.rohy-admin-sidebar')).toBeVisible({ timeout: 20_000 });
}

function watchFailures(page) {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 500) {
            failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        }
    });
    return failures;
}

function contentLandmark(panel, label, section) {
    const heading = panel.getByRole('heading').first();
    if (label === 'Lessons') return panel.getByRole('button', { name: 'New lesson', exact: true });
    if (label !== 'Analytics') return heading;
    const emptySequences = panel.getByText(/No events match the current filters/);
    const landmarks = {
        Clusters: heading.or(panel.getByText('At least two sequences are needed for clustering.', { exact: true })),
        'Process Map': panel.getByRole('button', { name: 'Export PNG', exact: true }).or(panel.getByText('No data', { exact: true })).or(emptySequences),
        Attention: panel.getByRole('heading', { name: 'Attention 2', exact: true }).or(panel.getByText('No engagement data in the current selection.', { exact: true })),
        Affect: panel.getByRole('heading', { name: 'Affect 2', exact: true }).or(panel.getByText('No affect windows in the current selection.', { exact: true })),
        Gaze: heading.or(panel.getByText(/^No gaze data in the current selection/)),
        Compare: panel.getByText('Compare by', { exact: true }).or(panel.getByText(/^No windows in the current selection. Comparisons/)),
        Sessions: panel.getByRole('button', { name: 'JSON', exact: true }),
        Text: heading.or(panel.getByText('No typing episodes for this selection', { exact: true })),
        Voice: heading.or(panel.getByText('No voice turns for this selection', { exact: true })),
    };
    return (landmarks[section] || heading.or(emptySequences)).first();
}

async function returnToSimulation(page) {
    await page.locator('.rohy-admin-sidebar').getByRole('button', { name: 'Simulation', exact: true }).click();
    // The room tour is browser-scoped and first appears when leaving settings.
    const skip = page.getByRole('button', { name: 'Skip', exact: true });
    await expect(async () => {
        if (await skip.isVisible()) await skip.click();
        await expect(page.getByText('Getting started', { exact: true })).toBeHidden();
        await page.getByRole('button', { name: /settings and profile menu/i }).click();
        await page.getByTestId('menu-profile').click();
    }).toPass({ timeout: 20_000 });
}

async function verifyPanel(page, panel, label, landmark = panel.getByRole('heading').first()) {
    await expect(landmark, `${label}: missing content landmark`).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator('svg.animate-spin'), `${label}: loading did not finish`).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => (await panel.innerText()).trim().length, { message: `${label}: blank content` }).toBeGreaterThan(30);
    const width = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
    }));
    expect(width.scroll, `${label}: horizontal document overflow`).toBeLessThanOrEqual(width.viewport + 1);
    const header = page.locator('.rohy-admin-header--fullpage');
    if (await header.count()) {
        await expect(async () => {
            const dock = await page.getByTestId('oyon-capture-dock').boundingBox();
            if (!dock || dock.width === 0 || dock.height === 0) return;
            const groups = await header.locator(':scope > div').evaluateAll((elements) => elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            }));
            expect(groups, `${label}: missing header branding/action groups`).toHaveLength(2);
            for (const group of groups) {
                const horizontal = Math.min(dock.x + dock.width, group.x + group.width) - Math.max(dock.x, group.x);
                const vertical = Math.min(dock.y + dock.height, group.y + group.height) - Math.max(dock.y, group.y);
                expect(horizontal <= 0 || vertical <= 0, `${label}: capture dock overlaps header branding/actions`).toBe(true);
            }
        }).toPass({ timeout: 10_000 });
    }
    const stem = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    // Settings forms extend below the fold. Capture each scroll position so
    // the review includes the lower controls, not just the panel header.
    const scrollable = await panel.evaluate((element) => {
        const candidates = [element, ...element.querySelectorAll('*')];
        return candidates.findIndex((candidate) => candidate.scrollHeight > candidate.clientHeight + 1
            && ['auto', 'scroll'].includes(getComputedStyle(candidate).overflowY));
    });
    let positions = 1;
    if (scrollable >= 0) {
        positions = await panel.evaluate((element, index) => {
            const candidate = [element, ...element.querySelectorAll('*')][index];
            candidate.scrollTop = 0;
            return Math.ceil(candidate.scrollHeight / Math.max(1, candidate.clientHeight));
        }, scrollable);
    }
    for (let part = 0; part < positions; part += 1) {
        if (scrollable >= 0) {
            await panel.evaluate((element, { index, part }) => {
                const candidate = [element, ...element.querySelectorAll('*')][index];
                candidate.scrollTop = part * candidate.clientHeight;
            }, { index: scrollable, part });
        }
        await page.screenshot({ path: test.info().outputPath(`${stem}-${part + 1}.png`) });
    }
    if (scrollable >= 0) {
        await panel.evaluate((element, index) => {
            [element, ...element.querySelectorAll('*')][index].scrollTop = 0;
        }, scrollable);
    }
}

for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 820, height: 1180 },
]) {
    test(`all admin settings render at ${viewport.name} size`, async ({ adminPage }) => {
        test.setTimeout(240_000);
        await adminPage.setViewportSize({ width: viewport.width, height: viewport.height });
        const failures = watchFailures(adminPage);
        await openSettings(adminPage);
        const sidebar = adminPage.locator('.rohy-admin-sidebar');
        const panel = adminPage.locator('.rohy-admin-page');
        await expect(sidebar.getByRole('button')).toHaveText(['Simulation', ...ADMIN_TABS]);
        for (const label of ADMIN_TABS) {
            await test.step(label, async () => {
                await sidebar.getByRole('button', { name: label, exact: true }).click();
                await verifyPanel(adminPage, panel, `${viewport.name}-${label}`, contentLandmark(panel, label));
                if (SUB_SECTIONS[label]) {
                    for (const section of SUB_SECTIONS[label]) {
                        await panel.getByRole('button', { name: section, exact: true }).click();
                        await verifyPanel(adminPage, panel, `${viewport.name}-${label}-${section}`, contentLandmark(panel, label, section));
                    }
                }
            });
        }
        expect(failures, 'settings triggered runtime or server errors').toEqual([]);
    });
}

test('learner settings expose only learner tabs and render each panel', async ({ studentPage }) => {
    const failures = watchFailures(studentPage);
    await openSettings(studentPage);
    const sidebar = studentPage.locator('.rohy-admin-sidebar');
    await expect(sidebar.getByRole('button')).toHaveText(['Simulation', ...LEARNER_TABS]);
    for (const label of LEARNER_TABS) {
        await sidebar.getByRole('button', { name: label, exact: true }).click();
        await verifyPanel(studentPage, studentPage.locator('.rohy-admin-page'), `learner-${label}`);
    }
    expect(failures).toEqual([]);
});

test('profile tabs render and profile edits persist through reload', async ({ adminPage, baseURL }) => {
    const failures = watchFailures(adminPage);
    const api = await apiAsAdmin(baseURL);
    const original = await (await api.get('/api/user/profile')).json();
    try {
        await openSettings(adminPage);
        await returnToSimulation(adminPage);
        const profile = adminPage.locator('div.fixed.inset-0').filter({ has: adminPage.getByRole('button', { name: 'Profile', exact: true }) });
        await expect(profile).toBeVisible();
        for (const label of ['Profile', 'Password', 'AI Settings', 'Join a class']) {
            await profile.getByRole('button', { name: label, exact: true }).click();
            const landmark = {
                Profile: profile.getByPlaceholder('Your full name'),
                Password: profile.getByPlaceholder('Enter current password'),
                'AI Settings': profile.getByRole('heading', { name: 'AI Provider Configuration', exact: true }),
                'Join a class': profile.getByPlaceholder('e.g. ABC123'),
            }[label];
            await expect(landmark).toBeVisible();
            await verifyPanel(adminPage, profile, `profile-${label}`);
        }
        await profile.getByRole('button', { name: 'Profile', exact: true }).click();
        const nameInput = profile.getByPlaceholder('Your full name');
        await nameInput.fill('Release review profile');
        const saved = adminPage.waitForResponse((response) => response.url().endsWith('/api/user/profile') && response.request().method() === 'PUT');
        await profile.getByRole('button', { name: 'Save Changes', exact: true }).click();
        expect((await saved).ok()).toBe(true);
        const updated = await (await api.get('/api/user/profile')).json();
        expect(updated.user.name).toBe('Release review profile');
        // The init script retains settings on reload; re-open the profile normally.
        await adminPage.reload();
        await returnToSimulation(adminPage);
        await expect(adminPage.locator('div.fixed.inset-0').filter({ has: adminPage.getByRole('button', { name: 'Profile', exact: true }) }).getByPlaceholder('Your full name')).toHaveValue('Release review profile');
        expect(failures).toEqual([]);
    } finally {
        await api.put('/api/user/profile', { data: original.user });
        await api.dispose();
    }
});
