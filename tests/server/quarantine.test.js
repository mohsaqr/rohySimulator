// describeQuarantine (tests/utils/describeQuarantine.js), run for real: the
// fixture is executed in a child vitest, once without and once with
// ROHY_QUARANTINE=1, and the outcomes read from its JSON report.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vitestBin = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
const config = path.join(repoRoot, 'tests', 'fixtures', 'quarantine', 'vitest.config.js');

function runFixture(env) {
    let stdout;
    let exitCode = 0;
    try {
        stdout = execFileSync(process.execPath, [vitestBin, 'run', '--config', config, '--reporter=json'], {
            cwd: repoRoot, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        stdout = err.stdout;
        exitCode = err.status;
    }
    const report = JSON.parse(stdout.slice(stdout.indexOf('{')));
    const outcomes = Object.fromEntries(report.testResults.flatMap((file) => file.assertionResults)
        .map((a) => [a.fullName.replace(' [quarantined]', ''), a.status]));
    const failedSuites = report.testResults.filter((file) => file.status === 'failed').length;
    return { exitCode, outcomes, failedSuites };
}

describe('describeQuarantine', () => {
    it('without ROHY_QUARANTINE a failure fails, exactly as an unquarantined test', () => {
        const { exitCode, outcomes, failedSuites } = runFixture({ ROHY_QUARANTINE: '' });
        expect(exitCode).toBe(1);
        expect(failedSuites).toBe(1);
        expect(outcomes['a known flake fails']).toBe('failed');
        expect(outcomes['a known flake passes']).toBe('passed');
        // vitest reports the tests under a failed beforeAll as skipped and
        // fails the SUITE, which is what exitCode/failedSuites assert.
        expect(outcomes['a flake in setup never gets its setup']).toBe('skipped');
    }, 60_000);

    it('with ROHY_QUARANTINE=1 a failure is reported as skipped and the run passes', () => {
        const { exitCode, outcomes, failedSuites } = runFixture({ ROHY_QUARANTINE: '1' });
        expect(exitCode).toBe(0);
        expect(failedSuites).toBe(0);
        expect(outcomes['a known flake fails']).toBe('skipped');
        // Not a blanket skip: a test that passes still passes.
        expect(outcomes['a known flake passes']).toBe('passed');
        expect(outcomes['a flake in setup never gets its setup']).toBe('skipped');
    }, 60_000);
});
