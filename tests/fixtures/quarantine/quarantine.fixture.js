// Fixture for tests/server/quarantine.test.js: one quarantined block holding a
// test that always fails, one that passes, and a block whose setup fails.
// The comments below are the ones scripts/check-quarantine.mjs requires; this
// directory is excluded from that check because the date is fixed.
import { describeQuarantine } from '../../utils/describeQuarantine.js';

describeQuarantine('a known flake', ({ it }) => {
    it('fails', () => { throw new Error('flaked'); });
    it('passes', () => {});
});

describeQuarantine('a flake in setup', ({ it, beforeAll }) => {
    beforeAll(() => { throw new Error('setup flaked'); });
    it('never gets its setup', () => {});
});
