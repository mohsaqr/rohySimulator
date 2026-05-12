import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
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
