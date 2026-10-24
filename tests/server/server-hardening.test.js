// server/server.js boot and static-mount hardening.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../utils/startTestServer.js';
import { createTestDb } from '../utils/seedDb.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Regression lock: /oyon served the WHOLE OyonR/ tree (HANDOFF.md, docs/, tests/, scripts/, package.json, node_modules/) unauthenticated with a relaxed frame CSP; the app only ever loads /oyon/standalone/… (security audit 2026-10-24)
describe('/oyon static mount', () => {
    let server;
    beforeAll(async () => { server = await startTestServer({ seed: false, env: { ROHY_BIND: '127.0.0.1' } }); }, 60_000);
    afterAll(async () => { await server?.close(); });

    const get = (p) => fetch(`${server.baseUrl}${p}`);

    it.each(['/oyon/HANDOFF.md', '/oyon/package.json', '/oyon/README.md', '/oyon/scripts/download-models.sh', '/oyon/'])(
        '%s is not served', async (p) => {
            const res = await get(p);
            expect(res.status).toBe(404);
        }
    );

    it('still serves the standalone bundle under both prefixes, with the frame CSP', async () => {
        for (const p of ['/oyon/standalone/logs.html', '/standalone/logs.html']) {
            const res = await get(p);
            expect(res.status, p).toBe(200);
            expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors 'self'/);
        }
    });

    it('serves the OyonR/src modules the standalone pages import, and only .js', async () => {
        const mod = await get('/oyon/src/analytics/DynamicalFeatures.js');
        expect(mod.status).toBe(200);
        expect(mod.headers.get('content-type')).toMatch(/javascript/);
        // Not framed documents: they keep the app's own CSP, not the relaxed
        // frame-ancestors 'self' policy of the standalone pages.
        expect(mod.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
        expect((await get('/oyon/src/')).status).toBe(404);
    });

    // Regression lock: the listener always bound 0.0.0.0, so behind a same-host proxy the Node port was reachable from the LAN directly (security audit 2026-10-24)
    it('binds the interface named by ROHY_BIND', () => {
        expect(server.getStdout()).toMatch(/"msg":"http server listening","host":"127\.0\.0\.1"/);
    });
});

// Regression lock: on EADDRINUSE the server silently moved to port+1, so in production the proxy kept forwarding to a port some OTHER process owned (security audit 2026-10-24)
describe('busy port in production', () => {
    it('exits non-zero instead of falling back to the next port', async () => {
        const blocker = net.createServer();
        await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
        const { port } = blocker.address();
        const { dbPath, cleanup } = await createTestDb({ seed: false, label: 'busy-port' });
        try {
            const child = spawn('node', ['server/server.js'], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    NODE_ENV: 'production',
                    PORT: String(port),
                    ROHY_BIND: '127.0.0.1',
                    ROHY_DB: dbPath,
                    JWT_SECRET: 'busy-port-test-secret-0123456789abcdef0123456789abcdef',
                    FRONTEND_URL: `http://localhost:${port}`,
                    TRANSFORMERS_CACHE: path.join(path.dirname(dbPath), 'hf'),
                    ROHY_TRUST_PROXY: 'loopback',
                    ALLOW_DEFAULT_USERS: '',
                    TLS_CERT_PATH: '',
                    TLS_KEY_PATH: '',
                    ROHY_PROVA_URL: 'off',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let out = '';
            child.stdout.on('data', (b) => { out += b; });
            child.stderr.on('data', (b) => { out += b; });
            const code = await new Promise((resolve, reject) => {
                const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`server did not exit:\n${out}`)); }, 60_000);
                child.once('exit', (c) => { clearTimeout(t); resolve(c); });
            });
            expect(code, out).toBe(1);
            expect(out).toMatch(/refusing to fall back to another port in production/);
            expect(out).not.toMatch(/http port in use, retrying/);
        } finally {
            await new Promise((resolve) => blocker.close(resolve));
            await cleanup();
        }
    }, 90_000);
});
