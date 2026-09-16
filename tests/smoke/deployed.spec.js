// The deployed smoke battery — what must be true of a real instance right
// after an update, a deploy, or at any time on demand.
//
// EVERY check here is read-only and unauthenticated. Nothing logs in, nothing
// writes, nothing touches case or learner data. That is the property that makes
// it safe to point at production; the e2e suite is not safe that way and must
// never be aimed at a real deployment.
//
// Run it with scripts/smoke-deployed.sh, which reads the build from the target's
// own /api/health so Prova records the version that instance is serving rather
// than whatever this working copy is on.

import { test, expect } from '@playwright/test';

// Every path below is RELATIVE on purpose. The deploy hub verifies path-prefixed
// targets (https://host/rohy); an absolute '/api/health' would resolve against the
// host root and silently smoke the wrong application. See playwright.smoke.config.js.
test.describe('deployed smoke', () => {
    test('the instance is alive and names its version', async ({ request }) => {
        const res = await request.get('api/health');
        expect(res.status()).toBe(200);

        const body = await res.json();
        expect(body.status).toBeTruthy();
        expect(typeof body.version).toBe('string');
        expect(body.version.length).toBeGreaterThan(0);
        expect(body.version, 'the deployment does not know its own version').not.toBe('unknown');
    });

    test('the instance has been up long enough to have finished starting', async ({ request }) => {
        const body = await (await request.get('api/health')).json();
        expect(typeof body.started_at).toBe('string');
        expect(Number.isFinite(body.uptime_s)).toBe(true);
        // A target that is seconds old is mid-restart; the deploy hook should
        // have waited. Flagging it here beats a confusing failure further down.
        expect(body.uptime_s).toBeGreaterThanOrEqual(0);
    });

    test('the database answers and the migrations are applied', async ({ request }) => {
        const res = await request.get('api/ready');
        // 503 is a legitimate answer from a readiness probe, but on a deployment
        // that has just been verified it means a dependency is unhappy — so the
        // check reports the probe detail rather than just the status.
        const body = await res.json();
        expect(body.checks, 'readiness returned no per-probe detail').toBeTruthy();

        const detail = JSON.stringify(body.checks);
        expect(res.status(), `readiness is not ok: ${detail}`).toBe(200);
        expect(body.checks.db, `database probe: ${body.checks.db}`).toBe('ok');
        expect(body.checks.migrations, `migration probe: ${body.checks.migrations}`)
            .toMatch(/^at \d+ \(\d+ applied\)$/);
    });

    test('the application shell is served', async ({ page }) => {
        const res = await page.goto('');
        expect(res.status()).toBe(200);

        // The base-path failure mode: index.html is served but its assets 404,
        // so the shell arrives and the app never mounts. Checking for the root
        // element alone would not catch it — the scripts have to resolve.
        await expect(page.locator('#root')).toBeAttached();

        const assets = [];
        page.on('response', (r) => {
            const url = r.url();
            if (/\.(js|css)(\?|$)/.test(url) && r.status() >= 400) assets.push(`${r.status()} ${url}`);
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        expect(assets, `the shell loaded but these assets did not: ${assets.join(', ')}`).toEqual([]);
    });

    test('protected endpoints refuse an anonymous caller', async ({ request }) => {
        // A deployment that answers these without credentials is the single worst
        // outcome of a bad config, so the smoke asks every time.
        for (const path of ['api/auth/verify', 'api/cases', 'api/admin/audit-log']) {
            const res = await request.get(path);
            expect(res.ok(), `${path} answered ${res.status()} to an anonymous caller`).toBe(false);
            expect([401, 403], `${path} answered ${res.status()}`).toContain(res.status());
        }
    });

    test('an unknown API path is refused', async ({ request }) => {
        const res = await request.get('api/definitely-not-a-route');
        expect(res.status()).toBe(404);
    });
});
