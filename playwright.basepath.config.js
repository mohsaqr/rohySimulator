// The app served under a base path (/rohy/), as `npm run build` builds it and
// as an install behind a path-stripping proxy serves it. The main suite runs
// at '/', where a hand-written '/api/…' address happens to work; this run is
// where it 404s. Build first: `npm run build:basepath`.
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = 4831;
const PROXY_PORT = 4832;
// Fixed, not mkdtemp: the config is loaded again in each worker, and the spec
// writes the slide library the server reads.
const WORK = path.join(os.tmpdir(), 'rohy-basepath');
fs.mkdirSync(WORK, { recursive: true });
export const BASEPATH_LIBRARY = path.join(WORK, 'library');
export const BASEPATH_SERVER = `http://127.0.0.1:${SERVER_PORT}`;

export default defineConfig({
    testDir: './tests/basepath',
    testMatch: /\.spec\.js$/,
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 120_000,
    outputDir: 'test-results-basepath',
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-basepath' }]],
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${PROXY_PORT}/rohy/`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        actionTimeout: 15_000,
        navigationTimeout: 20_000,
    },
    webServer: [
        {
            command: 'node server/server.js',
            url: `${BASEPATH_SERVER}/api/health`,
            timeout: 60_000,
            reuseExistingServer: false,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                PORT: String(SERVER_PORT),
                ROHY_DB: path.join(WORK, `db-${process.pid}.sqlite`),
                JWT_SECRET: 'rohy-basepath-secret',
                NODE_ENV: 'test',
                ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
                ROHY_DISABLE_GENERAL_RATE_LIMIT: '1',
                PIPER_DISABLED: '1',
                OYON_ENABLED: '1',
                ROHY_STARTER_CONTENT: 'off',
                ROHY_PLUGIN_LIBRARY_DIRS: `pathology=${BASEPATH_LIBRARY}`,
                NODE_OPTIONS: `--unhandled-rejections=warn --require ${path.resolve(__dirname, 'tests/e2e/preload-server.cjs')}`,
            },
        },
        {
            command: 'node tests/basepath/proxy.mjs',
            url: `http://127.0.0.1:${PROXY_PORT}/rohy/api/health`,
            timeout: 30_000,
            reuseExistingServer: false,
            env: { PROXY_PORT: String(PROXY_PORT), TARGET_PORT: String(SERVER_PORT), BASE_PATH: '/rohy' },
        },
    ],
});
