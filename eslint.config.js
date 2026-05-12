import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import unusedImports from 'eslint-plugin-unused-imports'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated / vendored trees we never want to lint. `dist/` is the
  // Vite build output. `frontend/` is a copy of dist/ that `npm run
  // build` produces for Express to serve. `OyonR/` is the upstream
  // submodule-style copy; its lint posture is owned upstream. All
  // node_modules and coverage outputs are noise.
  globalIgnores([
    'dist/**',
    'frontend/**',
    'OyonR/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'node_modules/**',
    '.vitest-cache/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      react,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // `react/jsx-uses-vars` + `react/jsx-uses-react` mark JSX-referenced
      // identifiers as used so the unused-imports auto-fix doesn't strip
      // `<Component />`-only imports or the React import on files using
      // the classic JSX transform. Without these rules every component
      // import looks dead to the analyzer.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // `unused-imports` splits the rule in two: `no-unused-imports`
      // gives us auto-fix removal of dead `import` declarations, while
      // `no-unused-vars` (the plugin's wrapper around eslint core) keeps
      // catching dead locals. We keep the same ignore-prefix convention
      // as before (^[A-Z_] for shouty consts that are intentional API).
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', {
        vars: 'all',
        varsIgnorePattern: '^[A-Z_]',
        args: 'after-used',
        argsIgnorePattern: '^_',
      }],

      // The react-hooks v7 "react-compiler" subset describes patterns the
      // optimizing compiler can't auto-memoize. They're optimization
      // hints, not bugs — useful to surface in editor + CI summary, but
      // not gates on the build. Keep `rules-of-hooks` as an error since
      // that's a real React API contract violation.
      'react-hooks/set-state-in-effect':         'warn',
      'react-hooks/purity':                      'warn',
      'react-hooks/immutability':                'warn',
      'react-hooks/static-components':           'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs':                        'warn',
      // `react-refresh/only-export-components` flags non-component exports
      // from .jsx files. HMR optimization only — production builds don't
      // care. Worth warning on so we trend toward clean component files,
      // but not a CI gate.
      'react-refresh/only-export-components':    'warn',
      // Empty catch blocks are an idiomatic JS pattern for best-effort
      // operations that should silently fall back on failure
      // (JSON.parse from localStorage, optional analytics computation,
      // pause-may-already-be-paused video cleanup, etc.). If you want
      // real error handling, write it explicitly — the lint rule
      // doesn't relax for empty `catch (e)` either, only for `catch {}`.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Server-side + build-config files run under Node, not the browser.
  // Without this block the default config (browser globals only) flags
  // every `process`, `__dirname`, `Buffer`, etc. as no-undef. These files
  // also never get hot-reloaded so the react-refresh rule has nothing to
  // say about them.
  {
    files: [
      'server/**/*.js',
      'scripts/**/*.js',
      'migrations/**/*.js',
      'bin/**/*.js',
      'kits/**/server/**/*.js',
      'deploy/**/*.{js,mjs}',
      'vite.config.js',
      'vitest.config.js',
      'playwright.config.js',
      'eslint.config.js',
      'postcss.config.js',
    ],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  // Test files run under vitest (jsdom for client, node for server).
  // They use node globals and don't need to follow the react-refresh
  // export rules because they're never live-reloaded.
  {
    files: [
      'tests/**/*.{js,jsx}',
      '**/*.test.{js,jsx}',
      'bench/**/*.{js,jsx}',
      'vitest.config.js',
      'playwright.config.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^_|^[A-Z_]',
        argsIgnorePattern: '^_',
      }],
    },
  },
  // Playwright e2e fixtures use the `use` callback pattern from
  // @playwright/test (`async ({ ... }, use) => { ... await use(value) ... }`).
  // The react-hooks plugin misreads `use(...)` as a React Hook call; in
  // these files it never is. Scoping the rule off to `tests/e2e/**` only.
  {
    files: ['tests/e2e/**/*.{js,jsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
])
