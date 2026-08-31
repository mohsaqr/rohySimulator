// The credential rohy presents to a content origin.
//
// It exists so an origin can be CLOSED to the public rather than merely
// unadvertised: a deployment proves which installation is asking, and a token
// can be revoked without touching the others.
//
// The properties that matter are about where the token does and does not go.
// It travels on rohy's own server-to-server fetch and nowhere else — not to
// the browser, not into a log, and it is not the learner's credential wearing
// a different hat.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { parsePluginOriginTokens, resetPluginOriginTokens, originRequestHeaders } from '../../server/lib/pluginOriginTokens.js';

const PASSWORD = 'T0kenP4th!';

describe('parsing the credential map', () => {
    beforeEach(() => resetPluginOriginTokens());

    it('reads <pluginId>=<token> pairs', () => {
        const m = parsePluginOriginTokens('pacs=abc123,pathology=def456');
        expect(m.get('pacs')).toBe('abc123');
        expect(m.get('pathology')).toBe('def456');
    });

    it('unset means anonymous, which is right for a public origin', () => {
        expect(parsePluginOriginTokens(undefined).size).toBe(0);
        expect(parsePluginOriginTokens('').size).toBe(0);
        expect(parsePluginOriginTokens('   ').size).toBe(0);
    });

    it('refuses malformed input rather than silently sending nothing', () => {
        // Each of these would otherwise become "the imaging quietly stopped
        // loading" while an operator believes the host is authenticated.
        expect(() => parsePluginOriginTokens('no-equals-sign')).toThrow(/not '<pluginId>=<token>'/);
        expect(() => parsePluginOriginTokens('pacs=')).toThrow(/empty token/);
        expect(() => parsePluginOriginTokens('PACS=abc')).toThrow(/lower_snake_case/);
        expect(() => parsePluginOriginTokens('pacs=a b')).toThrow(/whitespace/);
        expect(() => parsePluginOriginTokens('pacs=one,pacs=two')).toThrow(/twice/);
    });

    it('never puts the token in the error text', () => {
        // The entry is the thing that is malformed AND the thing that is
        // secret, so the message describes it instead of quoting it.
        try {
            parsePluginOriginTokens('sup3rs3cr3t-with-no-equals');
            throw new Error('should have thrown');
        } catch (err) {
            expect(err.message).not.toContain('sup3rs3cr3t');
        }
    });

    it('adds Authorization only for a plugin that has one', () => {
        process.env.ROHY_PLUGIN_ORIGIN_TOKENS = 'pacs=abc123';
        resetPluginOriginTokens();
        expect(originRequestHeaders('pacs', { accept: 'image/jpeg' }))
            .toEqual({ accept: 'image/jpeg', authorization: 'Bearer abc123' });
        expect(originRequestHeaders('pathology', { accept: 'image/jpeg' }))
            .toEqual({ accept: 'image/jpeg' });
        delete process.env.ROHY_PLUGIN_ORIGIN_TOKENS;
        resetPluginOriginTokens();
    });
});

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((res, rej) => {
        const db = new sqlite.Database(dbPath, (e) => (e ? rej(e) : res(db)));
    });
}
async function seedUser(dbPath, username, role) {
    const db = await openDb(dbPath);
    const hash = await bcrypt.hash(PASSWORD, 4);
    await new Promise((res, rej) => db.run(
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role], (e) => (e ? rej(e) : res()),
    ));
    await new Promise((r) => db.close(() => r()));
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    return (await res.json()).token;
}

describe('an authenticated origin, end to end', () => {
    let upstream; let server; let token; let seenAuth; let seenCookie;

    beforeAll(async () => {
        seenAuth = []; seenCookie = [];
        upstream = http.createServer((req, res) => {
            seenAuth.push(req.headers.authorization ?? null);
            seenCookie.push(req.headers.cookie ?? null);
            if (req.headers.authorization !== 'Bearer deployment-42') {
                res.writeHead(401); return res.end('no');
            }
            res.writeHead(200, { 'content-type': 'application/xml' });
            return res.end('<Image/>');
        });
        await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
        const origin = `http://127.0.0.1:${upstream.address().port}`;

        server = await startTestServer({
            seed: false,
            env: {
                ROHY_PLUGIN_ORIGINS: `pathology=${origin}`,
                ROHY_PLUGIN_ORIGIN_TOKENS: 'pathology=deployment-42',
            },
        });
        await seedUser(server.dbPath, 'token-reader', 'student');
        token = await login(server.baseUrl, 'token-reader');
    }, 90_000);

    afterAll(async () => {
        await server?.close();
        await new Promise((r) => upstream.close(r));
    });

    it('presents the deployment credential upstream and relays the content', async () => {
        const res = await fetch(`${server.baseUrl}/api/plugins/pathology/tiles/slide.dzi`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('<Image');
        expect(seenAuth).toContain('Bearer deployment-42');
    });

    it("sends rohy's credential, never the learner's, and no cookies", async () => {
        seenAuth.length = 0; seenCookie.length = 0;
        await fetch(`${server.baseUrl}/api/plugins/pathology/tiles/slide.dzi`, {
            headers: { authorization: `Bearer ${token}`, cookie: 'rohy_auth=should-not-travel' },
        });
        // Two separate authorisations: rohy decides whether this learner may
        // read, the origin decides whether this DEPLOYMENT may. Forwarding the
        // learner's token upstream is the confused-deputy shape.
        expect(seenAuth.every((a) => a === 'Bearer deployment-42')).toBe(true);
        expect(seenAuth).not.toContain(`Bearer ${token}`);
        expect(seenCookie.every((c) => c === null || !c.includes('should-not-travel'))).toBe(true);
    });

    it('the token never reaches the browser', async () => {
        const res = await fetch(`${server.baseUrl}/api/plugins/pathology/tiles/slide.dzi`, {
            headers: { authorization: `Bearer ${token}` },
        });
        const body = await res.text();
        expect(body).not.toContain('deployment-42');
        expect(JSON.stringify([...res.headers])).not.toContain('deployment-42');
    });
});

describe('an origin that refuses our credential', () => {
    let upstream; let server; let token;
    beforeAll(async () => {
        upstream = http.createServer((req, res) => { res.writeHead(401); res.end('no'); });
        await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
        server = await startTestServer({
            seed: false,
            env: {
                ROHY_PLUGIN_ORIGINS: `pathology=http://127.0.0.1:${upstream.address().port}`,
                ROHY_PLUGIN_ORIGIN_TOKENS: 'pathology=wrong-token',
            },
        });
        await seedUser(server.dbPath, 'rejected-reader', 'student');
        token = await login(server.baseUrl, 'rejected-reader');
    }, 90_000);
    afterAll(async () => {
        await server?.close();
        await new Promise((r) => upstream.close(r));
    });

    it('is an operator problem, reported distinctly from a wrong slide path', async () => {
        const res = await fetch(`${server.baseUrl}/api/plugins/pathology/tiles/slide.dzi`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(502);
        // Not plugin_remote_status: the fix is a credential, not a path.
        expect((await res.json()).code).toBe('plugin_remote_unauthorized');
    });
});
