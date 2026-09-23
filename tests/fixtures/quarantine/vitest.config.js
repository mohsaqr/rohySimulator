// Runs ONLY the quarantine fixture, for tests/server/quarantine.test.js. Not
// part of the suite: the root vitest.config.js never matches this directory.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        root: new URL('.', import.meta.url).pathname,
        include: ['*.fixture.js'],
        environment: 'node',
    },
});
