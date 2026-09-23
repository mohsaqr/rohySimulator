// The comparison behind the scheduled production check
// (scripts/check-prod-version.mjs, .github/workflows/prod-check.yml).

import { describe, expect, it } from 'vitest';
import { decideProdVersion, GRACE_MS } from '../../scripts/check-prod-version.mjs';

const TAG = Date.parse('2026-09-23T12:00:00Z');
const MIN = 60_000;

describe('decideProdVersion', () => {
    it('same version is ok, whatever the tag age', () => {
        expect(decideProdVersion({ liveVersion: '3.0.0-beta.113', tagVersion: '3.0.0-beta.113', tagTimeMs: TAG, nowMs: TAG + 600 * MIN }).verdict)
            .toBe('ok');
    });

    it('a different version inside the grace window is grace, not a failure', () => {
        const got = decideProdVersion({ liveVersion: '3.0.0-beta.112', tagVersion: '3.0.0-beta.113', tagTimeMs: TAG, nowMs: TAG + 14 * MIN });
        expect(got.verdict).toBe('grace');
        expect(got.message).toMatch(/14 min ago/);
    });

    it('a different version once the tag is older than the grace window fails', () => {
        const got = decideProdVersion({
            liveVersion: '3.0.0-beta.112', tagVersion: '3.0.0-beta.113', tagTimeMs: TAG, nowMs: TAG + 16 * MIN,
            startedAtMs: TAG - 60 * MIN,
        });
        expect(got.verdict).toBe('fail');
        expect(got.message).toMatch(/3\.0\.0-beta\.112.*3\.0\.0-beta\.113/);
        expect(got.message).toMatch(/has not restarted since the tag moved/);
    });

    it('the grace boundary is exclusive: exactly GRACE_MS old fails', () => {
        expect(decideProdVersion({ liveVersion: 'a', tagVersion: 'b', tagTimeMs: TAG, nowMs: TAG + GRACE_MS - 1 }).verdict).toBe('grace');
        expect(decideProdVersion({ liveVersion: 'a', tagVersion: 'b', tagTimeMs: TAG, nowMs: TAG + GRACE_MS }).verdict).toBe('fail');
    });

    it('says when the server restarted after the tag and still serves the old version', () => {
        const got = decideProdVersion({
            liveVersion: 'a', tagVersion: 'b', tagTimeMs: TAG, nowMs: TAG + 30 * MIN, startedAtMs: TAG + 5 * MIN,
        });
        expect(got.message).toMatch(/restarted at .*after the tag moved/);
    });

    it('a health response without a usable version fails, even inside the grace window', () => {
        ['', 'unknown', null, undefined].forEach((liveVersion) => {
            expect(decideProdVersion({ liveVersion, tagVersion: 'b', tagTimeMs: TAG, nowMs: TAG + MIN }).verdict).toBe('fail');
        });
    });
});
