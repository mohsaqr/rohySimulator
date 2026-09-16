// Boot and health — the first thing the battery asks of a build.
//
// This is deliberately the cheapest spec in the suite: if these fail, nothing
// downstream is worth reading. It answers "is this build alive, does it know
// what version it is, and is it serving the SPA?".
//
// The version assertion matters beyond a smoke check: Prova reads the build a
// MANUAL run is testing from `GET /api/health` → `version`, while the automated
// half takes its version from package.json. Those two must be the same string or
// the two halves of the battery land on different builds in Prova and the
// coverage matrix silently splits in two. This spec pins them together.
//
// Test titles here are public — prova/rohy-cases.yaml may reference them in its
// `covers:` patterns as `rohy:chromium::boot-health.spec.js › …`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

test.describe('boot and health', () => {
    test('health answers 200 with the version this build actually is', async ({ request }) => {
        const res = await request.get('/api/health');
        expect(res.status()).toBe(200);

        const body = await res.json();
        expect(body.status).toBeTruthy();
        expect(typeof body.version).toBe('string');
        expect(body.version.length).toBeGreaterThan(0);
        expect(body.version).not.toBe('unknown');

        // The contract that keeps Prova's manual and automated halves on one build.
        expect(body.version).toBe(pkg.version);
    });

    test('health reports an uptime and a start time', async ({ request }) => {
        const body = await (await request.get('/api/health')).json();
        expect(typeof body.started_at).toBe('string');
        expect(Number.isFinite(body.uptime_s)).toBe(true);
        expect(body.uptime_s).toBeGreaterThanOrEqual(0);
    });

    // NOTE: readiness is `/api/ready`, NOT `/api/health/ready`. Sub-routers in
    // server/routes.js declare their own full paths and are mounted bare on
    // `/api`, so health-routes.js's `router.get('/ready')` lands at /api/ready.
    // docs/DEPLOY.md:261 is the authority. Probing the wrong path gets a 404,
    // which reads as "the build is broken" when it only means "wrong URL".
    test('readiness reports the database and the applied migrations', async ({ request }) => {
        const res = await request.get('/api/ready');
        // A ready probe legitimately answers 503 when a dependency is unhappy;
        // what must never happen is a crash or an unroutable path.
        expect([200, 503]).toContain(res.status());

        const body = await res.json();
        expect(typeof body.version).toBe('string');
        expect(['ok', 'not_ready']).toContain(body.status);

        // The individual probes are the reason this endpoint exists — a ready
        // build knows its db is answering and how far its schema is migrated.
        expect(body.checks).toBeTruthy();
        expect(Object.keys(body.checks)).toEqual(
            expect.arrayContaining(['db', 'migrations', 'ingest', 'timestamps']),
        );
        if (res.status() === 200) {
            expect(body.checks.db).toBe('ok');
            expect(body.checks.migrations).toMatch(/^at \d+ \(\d+ applied\)$/);
        }
    });

    test('the SPA shell is served, not an empty static directory', async ({ page }) => {
        const res = await page.goto('/');
        expect(res.status()).toBe(200);

        // `frontend/` empty is the classic "did you forget npm run build?" failure:
        // Express short-circuits and the document has no app root to mount into.
        await expect(page.locator('#root')).toBeAttached();
        const html = await page.content();
        expect(html).toMatch(/<script/i);
    });

    test('an unknown API path is refused, not answered', async ({ request }) => {
        const res = await request.get('/api/definitely-not-a-route');
        // The contract worth pinning is the status: an unrouted /api path must
        // never come back 200, which would let a typo in a client look like a
        // successful call. (The body is currently the SPA shell rather than the
        // `{error}` JSON the rest of the API uses — cosmetic, but it makes a
        // client-side JSON parse the first thing that fails.)
        expect(res.status()).toBe(404);
        expect(res.ok()).toBe(false);
    });
});
