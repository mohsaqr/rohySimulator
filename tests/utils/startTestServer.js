// Spawn the real Express server (`server/server.js`) on a random high
// port with an isolated sqlite database. Mirrors the pattern used by
// `scripts/audit-observability.sh` so server tests get the same
// guarantees the audit suite already relies on.
//
// Usage:
//
//   import { startTestServer } from '../utils/startTestServer.js';
//
//   let server;
//   beforeAll(async () => { server = await startTestServer(); });
//   afterAll(async () => { await server.close(); });
//
//   it('responds to /health', async () => {
//     const res = await fetch(`${server.baseUrl}/api/admin/database-stats`);
//     expect(res.status).toBe(401); // expected without auth
//   });
//
// Why spawn instead of `app.listen()` in-process?
//   - server/server.js + server/db.js initialize a singleton sqlite
//     connection at import time. Re-importing per test would either
//     reuse the singleton (wrong DB) or require deep module-cache
//     surgery. Spawning a child uses the real boot path, which is the
//     same path the audit scripts and dev server use — so what we test
//     is what we ship.
//
// The child inherits a temp ROHY_DB pointed at a fresh sqlite file we
// create up front (so we can also assert on its contents from the test
// process if we want).

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from './seedDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

// Ask the OS for a free ephemeral port by binding to :0 and reading back the
// assigned port, then releasing it. Under the full parallel suite (~30
// server-spawning files running at once) a fixed random range collides via
// the birthday paradox — two children pick the same port, the loser exits on
// EADDRINUSE, and the whole file dies at beforeAll. An OS-assigned port has no
// such range to exhaust; the residual free-then-rebind race is covered by the
// spawn retry loop in startTestServer.
function findFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close((err) => (err ? reject(err) : resolve(port)));
        });
    });
}

async function waitForReady(baseUrl, child, { timeoutMs = 60_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`server exited early with code ${child.exitCode}`);
        }
        try {
            const res = await fetch(`${baseUrl}/`, { method: 'GET' });
            // 200 (frontend served) or 404 (no frontend dir) both prove the
            // server is up. Connection errors land in catch.
            if (res.status >= 200 && res.status < 600) return;
        } catch {
            // not yet listening; sleep and retry
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server did not become ready within ${timeoutMs}ms (${baseUrl})`);
}

/**
 * Start a throwaway server backed by a fresh DB.
 *
 * @param {object} [opts]
 * @param {number} [opts.port]              Override the random port.
 * @param {object} [opts.env]               Extra env vars for the child.
 * @param {boolean} [opts.seed=false]       Pass through to createTestDb.
 * @param {boolean} [opts.silent=true]      Pipe stdout/stderr away from the parent.
 * @returns {Promise<{baseUrl, port, dbPath, close}>}
 */
export async function startTestServer(opts = {}) {
    const { port: fixedPort, env = {}, seed = false, silent = true } = opts;

    const { dbPath, cleanup: cleanupDb } = await createTestDb({ seed, label: 'srv' });

    // Retry the spawn if the child dies before becoming ready. The only
    // expected early death is a port race (another parallel test grabbed the
    // freed ephemeral port between findFreePort() and the child's bind), which
    // a fresh port fixes. A caller-pinned port is honoured and NOT retried —
    // if it's taken, that's a real conflict the author should see.
    const MAX_ATTEMPTS = fixedPort ? 1 : 4;
    let lastErr;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const port = fixedPort ?? (await findFreePort());
        const childEnv = {
            ...process.env,
            PORT: String(port),
            ROHY_DB: dbPath,
            // Force NODE_ENV=test so any prod-only branches in server code
            // (eg. CORS allowed-origins) don't trip on localhost.
            NODE_ENV: 'test',
            // Tests should never read or write the operator's JWT secret.
            JWT_SECRET: env.JWT_SECRET || 'rohy-tests-secret',
            ...env,
        };

        const child = spawn('node', ['server/server.js'], {
            cwd: repoRoot,
            env: childEnv,
            stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        });

        const stdoutChunks = [];
        const stderrChunks = [];
        if (silent) {
            child.stdout?.on('data', (b) => stdoutChunks.push(b));
            child.stderr?.on('data', (b) => stderrChunks.push(b));
        }

        const baseUrl = `http://localhost:${port}`;
        try {
            await waitForReady(baseUrl, child);
        } catch (err) {
            const out = Buffer.concat(stdoutChunks).toString('utf8');
            const errOut = Buffer.concat(stderrChunks).toString('utf8');
            try { child.kill('SIGKILL'); } catch { /* noop */ }
            lastErr = new Error(
                `${err.message}\n--- server stdout ---\n${out}\n--- server stderr ---\n${errOut}`
            );
            // Retry only on an early exit (port race / boot crash re-attempt);
            // a readiness timeout means the server is up but slow — retrying
            // won't help, so surface it immediately.
            const isEarlyExit = /server exited early/.test(err.message);
            if (isEarlyExit && attempt < MAX_ATTEMPTS - 1) continue;
            await cleanupDb();
            throw lastErr;
        }

        return buildHandle({ child, baseUrl, port, dbPath, cleanupDb, stdoutChunks, stderrChunks });
    }
    // Unreachable in practice — the loop either returns a handle or throws.
    await cleanupDb();
    throw lastErr;
}

function buildHandle({ child, baseUrl, port, dbPath, cleanupDb, stdoutChunks, stderrChunks }) {

    let closed = false;
    async function close() {
        if (closed) return;
        closed = true;
        try {
            child.kill('SIGTERM');
            await new Promise((resolve) => {
                if (child.exitCode !== null) return resolve();
                const t = setTimeout(() => {
                    try { child.kill('SIGKILL'); } catch { /* noop */ }
                    resolve();
                }, 3000);
                child.once('exit', () => { clearTimeout(t); resolve(); });
            });
        } finally {
            await cleanupDb();
        }
    }

    return {
        baseUrl,
        port,
        dbPath,
        close,
        // Logs are useful in test failures.
        getStdout: () => Buffer.concat(stdoutChunks).toString('utf8'),
        getStderr: () => Buffer.concat(stderrChunks).toString('utf8'),
    };
}

export default startTestServer;
