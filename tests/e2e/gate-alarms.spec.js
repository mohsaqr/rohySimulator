// Alarms and the scenario clock, as the learner meets them: a vital crosses
// its limit on its own (the case's scenario drives it, nobody touches a
// control), the monitor names the alarm, it stays until acknowledged, and it
// does not follow the learner into the debrief.
//
// The case is built for this spec: a short automatic timeline that takes the
// heart rate from 80 to 150 — over the default 120 limit — and back to 80, so
// one case shows the breach, the trajectory and the recovery in under a minute.

import { test, expect, waitForSeed } from './fixtures/index.js';
import { enterLiveCase, disposeLearnerApi, createAssignedCase, pickCase, room } from './fixtures/liveCase.js';

const RUN_TAG = `e2e-alarms-${Date.now()}`;
const frame = (time, hr) => ({
    time, params: { hr, spo2: 98, rr: 16, bpSys: 120, bpDia: 80 }, rhythm: 'NSR', conditions: { pvc: false, stElev: 0 },
});
const SCENARIO = { enabled: true, autoStart: true, timeline: [frame(0, 80), frame(8, 150), frame(30, 150), frame(40, 80)] };

let theCase;

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    const base = await pickCase(baseURL);
    const baseConfig = typeof base.config === 'string' ? JSON.parse(base.config) : (base.config || {});
    theCase = await createAssignedCase(baseURL, {
        name: `${RUN_TAG} rising heart rate`,
        config: {
            ...baseConfig,
            greeting: undefined,
            initialVitals: { hr: 80, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, rhythm: 'NSR', conditions: { pvc: false, stElev: 0 } },
        },
        scenario: SCENARIO,
    });
});

test.afterAll(disposeLearnerApi);

const hr = async (page) => Number(await page.getByTestId('vital-hr').getAttribute('data-value'));
const alarmRows = (page) => page.getByTestId('clinical-alarm-row');
const hrAlarm = (page) => alarmRows(page).filter({ hasText: /HR high/i });

/** Count oscillators the page creates: every alarm tone is one. */
async function countTones(page) {
    await page.addInitScript(() => {
        window.__tones = 0;
        const wrap = (Base) => Base && class extends Base {
            createOscillator() { window.__tones += 1; return super.createOscillator(); }
        };
        if (window.AudioContext) window.AudioContext = wrap(window.AudioContext);
        if (window.webkitAudioContext) window.webkitAudioContext = wrap(window.webkitAudioContext);
    });
}

// ---------------------------------------------------------------------------

test.describe('a vital out of range', () => {
    // ALARM.BREACH.01 + SCENARIO.TIME.01
    test('the scenario moves the vitals on its own, and the breach raises a named alarm the learner cannot miss', async ({ page, baseURL }) => {
        test.setTimeout(120_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-breach`, theCase);

        // The patient changes without the learner doing anything, along the
        // case's trajectory: the heart rate climbs towards the scenario's 150
        // rather than wandering around where it started.
        const samples = [];
        const until = Date.now() + 20_000;
        while (Date.now() < until && (samples.at(-1) ?? 0) < 140) {
            samples.push(await hr(page));
            await page.waitForTimeout(1_000);
        }
        expect(samples.at(-1), `heart rate over time: ${samples.join(' ')}`).toBeGreaterThanOrEqual(140);
        expect(samples.at(-1) - samples[0], 'it moved along the trajectory, not by noise').toBeGreaterThan(40);
        const falls = samples.slice(1).filter((v, i) => v < samples[i] - 5);
        expect(falls, `the climb is a climb: ${samples.join(' ')}`).toEqual([]);

        // Within seconds of crossing the limit: an alarm on the monitor that
        // names the vital and its severity, and the bell shows it.
        await expect(hrAlarm(page).first(), 'the alarm names the vital').toBeVisible({ timeout: 15_000 });
        const severity = await hrAlarm(page).first().getAttribute('data-severity');
        expect(['warning', 'critical', 'WARNING', 'CRITICAL'], `severity ${severity}`).toContain(severity);
        await expect(hrAlarm(page).first(), 'and shows its severity').toContainText(new RegExp(severity, 'i'));
        await expect(page.getByTestId('monitor-alarm-bell')).not.toHaveAttribute('data-active-count', '0');
    });

    // ALARM.BREACH.02
    test('an alarm stays listed after the vital recovers, and clears only when acknowledged', async ({ page, baseURL }) => {
        test.setTimeout(150_000);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-latch`, theCase);
        await expect(hrAlarm(page).first()).toBeVisible({ timeout: 30_000 });

        // The scenario brings the heart rate back into range by itself.
        await expect.poll(() => hr(page), { message: 'the heart rate recovers', timeout: 60_000, intervals: [1_000] })
            .toBeLessThan(110);
        await page.waitForTimeout(5_000);
        await expect(hrAlarm(page).first(), 'a transient breach is not erased').toBeVisible();

        await hrAlarm(page).first().getByRole('button', { name: 'Acknowledge' }).click();
        await expect(hrAlarm(page), 'acknowledged, it clears').toHaveCount(0, { timeout: 10_000 });
        await expect(page.getByTestId('monitor-alarm-bell')).toHaveAttribute('data-active-count', '0', { timeout: 10_000 });
    });

    // ALARM.BREACH.04
    test('ending the case with an alarm sounding brings no alarm into the debrief', async ({ page, baseURL }) => {
        test.setTimeout(120_000);
        await countTones(page);
        await enterLiveCase(page, baseURL, `${RUN_TAG}-quiet`, theCase);
        await expect(hrAlarm(page).first()).toBeVisible({ timeout: 30_000 });

        await page.getByTestId('end-session').click();
        await page.getByTestId('end-session-confirm').click();
        await expect(page.getByTestId('room-view')).toHaveAttribute('data-room', 'consultant', { timeout: 15_000 });

        // No alarm strip, no alarm banner, and no tone after the end.
        const tonesAtEnd = await page.evaluate(() => window.__tones);
        await page.waitForTimeout(6_000);
        await expect(alarmRows(page)).toHaveCount(0);
        await expect(page.getByRole('alert').filter({ hasText: /HR high/i })).toHaveCount(0);
        expect(await page.evaluate(() => window.__tones), 'no alarm tone after the end').toBe(tonesAtEnd);
        await expect(room(page, 'consultant')).toHaveAttribute('aria-pressed', 'true');
    });
});
