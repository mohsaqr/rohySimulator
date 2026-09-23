// A describe block for a test that is known to flake, quarantined while its
// defect is open.
//
//   // QUARANTINED: 2026-09-23
//   // PROVA-DEFECT: https://prova.lacarm.com/defects/12
//   describeQuarantine('the thing that flakes', ({ it, beforeAll }) => {
//       beforeAll(async () => { ... });
//       it('does the thing', async () => { ... });
//   });
//
// WITHOUT ROHY_QUARANTINE=1 it is a plain `describe`: a local run sees the
// failure, exactly as before it was quarantined. WITH ROHY_QUARANTINE=1 (the CI
// `test` job) a failure is logged as a warning and the test is reported
// SKIPPED instead of failed, so a known flake cannot turn the gate red while
// its defect is open — and the skip is visible in the run, not hidden.
//
// The block receives its own `it`/`test` and hooks, and must use them: the
// wrapping lives in those, not in vitest's globals. A failed beforeAll or
// beforeEach skips the tests it would have fed (with the hook's error in the
// warning); a failed afterEach/afterAll is logged.
//
// The two comments above the call are required, and checked by
// scripts/check-quarantine.mjs in the lint job: a quarantine names its Prova
// defect, and expires after 30 days.

import { afterAll, afterEach, beforeAll, beforeEach, describe, it as vitestIt } from 'vitest';

const warn = (what, err) => {
    console.warn(`[quarantine] ${what} failed and is reported as skipped: ${err?.stack || err}`);
};

export function describeQuarantine(name, fn) {
    if (process.env.ROHY_QUARANTINE !== '1') {
        return describe(name, () => fn({
            it: vitestIt, test: vitestIt, beforeAll, beforeEach, afterEach, afterAll,
        }));
    }

    return describe(`${name} [quarantined]`, () => {
        // The error of a setup hook that failed, so the tests it would have
        // fed are skipped rather than failed.
        let setupError = null;

        // The wrappers take NO parameter: vitest 4 parses a hook's first
        // parameter as a fixture request and refuses anything but an object
        // pattern. So a quarantined block's hooks do not receive vitest's
        // context; none of today's hooks use it.
        const guardSetup = (hook) => (body, timeout) => hook(async () => {
            if (setupError) return;
            try {
                await body();
            } catch (err) {
                setupError = err;
                warn(`${name} › setup`, err);
            }
        }, timeout);

        const guardTeardown = (hook) => (body, timeout) => hook(async () => {
            try {
                await body();
            } catch (err) {
                warn(`${name} › teardown`, err);
            }
        }, timeout);

        const it = (title, body, timeout) => vitestIt(title, async (ctx) => {
            if (setupError) {
                warn(`${name} › ${title}`, setupError);
                ctx.skip();
            }
            try {
                await body(ctx);
            } catch (err) {
                warn(`${name} › ${title}`, err);
                ctx.skip();
            }
        }, timeout);

        fn({
            it,
            test: it,
            beforeAll: guardSetup(beforeAll),
            beforeEach: guardSetup(beforeEach),
            afterEach: guardTeardown(afterEach),
            afterAll: guardTeardown(afterAll),
        });
    });
}
