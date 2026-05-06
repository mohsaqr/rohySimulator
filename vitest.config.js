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
            // Phase 0: coverage thresholds are NOT enforced. Documented
            // targets for Phase 2/3 (server units + client units):
            //
            //   thresholds: {
            //     lines: 70,
            //     branches: 65,
            //     functions: 70,
            //     statements: 70,
            //   },
            //
            // Phase 4 raises these to 80%. Phase 5+ raise to 85%.
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
