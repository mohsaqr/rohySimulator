import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest configuration for rohySimulator.
//
// Uses the projects feature so:
//   - "client" tests run in jsdom and can mount React components.
//   - "server" tests run in node and can talk to a real sqlite file or spawn
//     a throwaway Express server.
//
// The aliases here mirror what vite.config.js exposes today (which is just
// the default React/JSX resolution — no custom aliases are configured in
// the bundler). When vite.config.js gains a resolve.alias map, mirror it
// here too. Coverage thresholds are intentionally NOT enforced in Phase 0;
// the documented targets live near the bottom of this file (commented).

const repoRoot = path.dirname(new URL(import.meta.url).pathname);

const sharedExclude = [
    'node_modules',
    'dist',
    'frontend',
    'kits',
    'migrations',
    'scripts',
    'medkit-app',
    'production',
    '**/*.config.{js,ts}',
];

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Mirror any future vite.config.js aliases here. None today.
            '@': path.resolve(repoRoot, 'src'),
        },
    },
    test: {
        // Top-level defaults shared by both projects.
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        // Phase 0 ships with no server tests yet (Phase 2 adds them) and
        // very few client tests. Don't error if a project's include glob
        // matches nothing.
        passWithNoTests: true,
        // Phase 7 performance benchmarks live under bench/. They use the
        // vitest `bench()` API and run via `npm run bench` (vitest bench).
        // The actual include lives under the server project below — bench
        // files import server-side modules (kokoro-js, child_process,
        // fs, ...) that would crash a jsdom worker, so we keep the bench
        // glob OFF the client project.
        benchmark: {
            include: [],
            exclude: ['node_modules', 'dist', 'frontend', 'kits', 'production'],
            reporters: ['default'],
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'json-summary'],
            exclude: [
                ...sharedExclude,
                'tests/**',
                '**/*.test.{js,jsx}',
                '**/*.spec.{js,jsx}',
                'src/main.jsx',
                'public/**',
                'docs/**',
            ],
            // Coverage ratchet (audit finding #5). Floors set just below
            // currently-achieved values as of 2026-05-07 so the suite
            // catches regressions but doesn't refuse to start. Raise these
            // numbers (never lower them) as new tests land — the audit's
            // documented Phase 2/3 target is 70%, Phase 4+ is 80%+.
            //
            // To check current actuals: `npm run test:ci` and read the
            // "All files" row in the v8 coverage table. If you're
            // adding tests that don't move the needle, that's fine; if
            // you're touching coverage-counted code without tests, this
            // gate should refuse the merge until you add some.
            //
            // Ratchet bumped after the observability pass + post-audit
            // tests landed (2026-05-07 evening): actuals 52.46/46.75/
            // 46.21/54.07. Floors now at the rounded-down whole percent
            // so floating-point variance across v8 runs doesn't trip CI.
            thresholds: {
                statements: 52,
                branches: 46,
                functions: 46,
                lines: 54,
            },
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'client',
                    environment: 'jsdom',
                    setupFiles: ['./tests/setup.js'],
                    include: [
                        'src/**/*.test.{js,jsx}',
                        'tests/client/**/*.test.{js,jsx}',
                    ],
                    exclude: sharedExclude,
                },
            },
            {
                extends: true,
                test: {
                    name: 'server',
                    environment: 'node',
                    include: [
                        'tests/server/**/*.test.{js,jsx}',
                    ],
                    exclude: sharedExclude,
                    // Phase 0 ships with no server tests yet — Phase 2
                    // adds them. Without this, `npm run test:server`
                    // would fail CI just because the directory is empty.
                    passWithNoTests: true,
                    // Several server tests spawn a real Express via
                    // startTestServer() in beforeAll. With the suite growing
                    // (administer-route, auth-refresh, auth-lockout, tts,
                    // analytics, …) parallel server boots contend for ports
                    // + sqlite migrations, occasionally pushing a beforeAll
                    // past the 10s default. 30s gives slow CI runs headroom
                    // without masking a genuinely-stuck hook.
                    hookTimeout: 30_000,
                    // Phase 7 benchmarks: bench files run in this (node)
                    // project so kokoro-js / child_process / fs imports
                    // resolve correctly. `vitest bench` reads benchmark.*
                    // and ignores test.include; `vitest run` does the
                    // opposite, so the two never overlap.
                    benchmark: {
                        include: ['bench/**/*.bench.{js,ts}'],
                    },
                },
            },
        ],
    },
});
