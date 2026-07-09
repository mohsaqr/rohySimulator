// Phase 6 audio fidelity #4 — TTS provider voices-endpoint smoke test.
//
// Why this exists
// ---------------
// `/api/tts/voices?provider=<p>` is the only endpoint the settings UI calls to
// populate its voice pickers. If a provider's catalog goes empty (build-time
// regression, model load failure, refactor that drops a key, OpenAI/Google
// removing a voice we hardcoded) the UI silently shows "no voices" and
// admins can't change persona voices until someone notices. That's the bug
// this test class is designed to catch.
//
// It's also intended to be the canary that fires daily (TESTING_PLAN.md
// Phase 6, line 197) the moment Google or OpenAI deprecates one of the
// names we hardcode in `server/services/{google,openai}Tts.js`.
//
// What it locks down
// ------------------
//   1. /api/tts/voices?provider=google   — non-empty array (catalog is
//      hardcoded, no API key needed for listing).
//   2. /api/tts/voices?provider=openai   — non-empty array (catalog is
//      hardcoded, no API key needed for listing).
//   3. /api/tts/voices?provider=kokoro   — non-empty array. Kokoro loads
//      the local model (~330 MB) the first time. The endpoint awaits
//      `loadKokoro()`, so we give the request a generous timeout. If the
//      model isn't cached on the test machine (CI cold cache) the first
//      hit can take 10–20s; if it 503s ("Kokoro TTS failed to load") on a
//      machine that hasn't fetched the weights, we skip rather than fail.
//   4. /api/tts/voices?provider=piper    — list of locally-installed Piper
//      voices. If `server/data/piper/` has no .onnx files (clean checkout,
//      Piper not provisioned), the route returns `{ voices: [], piperInstalled }`
//      legitimately — we treat that as a skip rather than a failure.
//   5. Each voice has `filename` and `displayName`. (The task brief says
//      `id`/`name` — the actual wire format is `filename`/`displayName`,
//      which is what the settings UI consumes via `voiceService.js`. We
//      lock the truth, not the brief.)
//   6. Catalog ordering for Google: Chirp 3 HD entries come before
//      Chirp HD, which come before Neural2. See CHANGES.md and
//      `server/services/googleTts.js` line 30 — quality ranking
//      Chirp 3 HD > Chirp HD > Neural2. Reordering this catalog has
//      bitten us before; lock it down.
//
// Strategy
// --------
// HTTP-boundary test: spawn the real server via `startTestServer` (same
// pattern as `tts-route.test.js` and the `scripts/audit-*.sh` suite) and
// hit `/api/tts/voices` with an admin JWT. We insert the admin row
// directly into the spawned sqlite DB instead of going through /auth/login
// — same trade-off as `tts-route.test.js`: avoids the auth rate limiter
// and bcrypt cost, and an unrelated login regression won't take this
// canary down.
//
// Constraints
// -----------
//   - Source files are NOT modified. Test-only.
//   - We skip cleanly when a provider isn't reachable on the test box
//     (Kokoro model not cached, Piper voices not provisioned). The point
//     of the canary is to catch upstream/static-catalog regressions, not
//     to fail on missing-local-model setups.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { startTestServer } from '../../utils/startTestServer.js';

const TEST_JWT_SECRET = 'rohy-tests-secret';

// Generous: server boot + admin row insert + jwt sign are all in beforeAll.
const BOOT_TIMEOUT_MS = 30_000;
// Kokoro can take ~3s to load the first time (download + init). Pad it.
const KOKORO_FETCH_TIMEOUT_MS = 30_000;

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

describe('GET /api/tts/voices — provider catalog smoke', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: TEST_JWT_SECRET } });

        const db = await openDb(server.dbPath);
        const passwordHash = await bcrypt.hash('testpass', 4);
        await dbRun(
            db,
            `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
            ['voicesmoke', 'Voice Smoke Admin', passwordHash, 'voicesmoke@example.com']
        );
        const row = await dbGet(
            db,
            'SELECT id, username, email, role, tenant_id FROM users WHERE username = ?',
            ['voicesmoke']
        );
        await dbClose(db);

        token = jwt.sign(
            { id: row.id, username: row.username, email: row.email, role: 'admin', tenant_id: row.tenant_id || 1 },
            TEST_JWT_SECRET,
            { expiresIn: '1h' }
        );
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        if (server) await server.close();
    });

    async function getVoices(provider, { timeoutMs = 10_000 } = {}) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
            const res = await fetch(
                `${server.baseUrl}/api/tts/voices?provider=${encodeURIComponent(provider)}`,
                {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: ac.signal,
                }
            );
            let json = null;
            try { json = await res.json(); } catch { /* not json */ }
            return { status: res.status, json };
        } finally {
            clearTimeout(timer);
        }
    }

    // ----- Google (hardcoded catalog) -------------------------------------

    it('google — returns a non-empty voices array', async () => {
        const { status, json } = await getVoices('google');
        expect(status).toBe(200);
        expect(json).toBeTruthy();
        expect(json.provider).toBe('google');
        expect(Array.isArray(json.voices)).toBe(true);
        expect(json.voices.length).toBeGreaterThan(0);
    });

    // ----- OpenAI (hardcoded catalog) -------------------------------------

    it('openai — returns a non-empty voices array', async () => {
        const { status, json } = await getVoices('openai');
        expect(status).toBe(200);
        expect(json).toBeTruthy();
        expect(json.provider).toBe('openai');
        expect(Array.isArray(json.voices)).toBe(true);
        expect(json.voices.length).toBeGreaterThan(0);
    });

    // ----- Kokoro (loads local model on first request) --------------------

    it('kokoro — returns a non-empty voices array (or skips if model unavailable)', async () => {
        const { status, json } = await getVoices('kokoro', { timeoutMs: KOKORO_FETCH_TIMEOUT_MS });

        // Kokoro initializes its model lazily. On a machine that has never
        // fetched the weights (and has no network) the route returns 503
        // {"error":"Kokoro TTS failed to load"}. Don't fail the canary on
        // that — it's a local provisioning issue, not the regression class
        // this test is built to catch.
        if (status === 503) {
            console.warn('[provider-smoke] kokoro TTS failed to load on this host — skipping');
            return;
        }

        expect(status).toBe(200);
        expect(json.provider).toBe('kokoro');
        expect(Array.isArray(json.voices)).toBe(true);
        expect(json.voices.length).toBeGreaterThan(0);
    }, KOKORO_FETCH_TIMEOUT_MS + 5_000);

    // ----- Piper (locally-installed .onnx voices) -------------------------

    it('piper — returns a list of locally installed voices (skips if none provisioned)', async () => {
        const { status, json } = await getVoices('piper');
        expect(status).toBe(200);
        expect(json.provider).toBe('piper');
        expect(Array.isArray(json.voices)).toBe(true);
        // server/data/piper/ may legitimately be empty on a fresh checkout
        // (the .onnx files are git-ignored / fetched separately). The
        // canary's job is to verify the endpoint shape; voice provisioning
        // is checked elsewhere.
        if (json.voices.length === 0) {
            console.warn('[provider-smoke] piper has no voices installed on this host — skipping shape check');
            return;
        }
        expect(json.voices.length).toBeGreaterThan(0);
    });

    // ----- Voice shape (the field names the UI consumes) ------------------

    it('every voice carries `filename` and `displayName` (the wire field names voiceService.js consumes)', async () => {
        // Hit each provider that's actually populated and assert shape.
        // Note: the task brief mentions `id`/`name`; the source of truth
        // (`server/services/{google,openai,kokoro}Tts.js` and the piper
        // mapping in routes.js around line 8757) returns `filename` +
        // `displayName`. We lock the actual wire format.
        const providers = ['google', 'openai'];
        for (const p of providers) {
            const { status, json } = await getVoices(p);
            expect(status, `${p} status`).toBe(200);
            expect(json.voices.length, `${p} voices`).toBeGreaterThan(0);
            for (const v of json.voices) {
                expect(typeof v.filename, `${p} filename`).toBe('string');
                expect(v.filename.length, `${p} filename`).toBeGreaterThan(0);
                expect(typeof v.displayName, `${p} displayName`).toBe('string');
                expect(v.displayName.length, `${p} displayName`).toBeGreaterThan(0);
            }
        }
    });

    // ----- Google catalog ordering: Chirp 3 HD > Chirp HD > Neural2 -------

    it('google — within each language, Chirp3 HD precedes Chirp HD, which precedes Neural2', async () => {
        // 2026-07-09: the catalogue now spans multiple languages (de/it/fi/sv
        // added for the i18n languages) and voice pickers group by language,
        // so the quality-tier ordering invariant is PER LANGUAGE — a German
        // Chirp3 voice listed after an English Neural2 is fine; a German
        // Neural2 before a German Chirp3 is not.
        const { status, json } = await getVoices('google');
        expect(status).toBe(200);

        // Classify each voice by tier from its filename. Anything else
        // (regional Neural2 entries already covered, future tiers we
        // haven't bucketed) is ignored for the ordering invariant.
        function tier(filename) {
            if (/Chirp3-HD/i.test(filename)) return 0;     // best
            if (/Chirp-HD/i.test(filename))  return 1;
            if (/Neural2/i.test(filename))   return 2;
            return -1; // unclassified — skip in ordering check
        }

        const byLanguage = new Map();
        json.voices.forEach((v, i) => {
            const t = tier(v.filename);
            if (t === -1) return;
            if (!byLanguage.has(v.language)) {
                byLanguage.set(v.language, { last: { 0: -1, 1: -1, 2: -1 }, first: { 0: Infinity, 1: Infinity, 2: Infinity } });
            }
            const s = byLanguage.get(v.language);
            if (i > s.last[t]) s.last[t] = i;
            if (i < s.first[t]) s.first[t] = i;
        });

        // en-US has all three tiers at time of writing — fail loudly if a
        // refactor drops one entirely (that's the regression we want to
        // catch).
        const enUS = byLanguage.get('en-US');
        expect(enUS.last[0], 'no en-US Chirp3 HD voices in google catalog').toBeGreaterThanOrEqual(0);
        expect(enUS.last[1], 'no en-US Chirp HD voices in google catalog').toBeGreaterThanOrEqual(0);
        expect(enUS.last[2], 'no en-US Neural2 voices in google catalog').toBeGreaterThanOrEqual(0);

        // Per language: last(Chirp3 HD) < first(Chirp HD) < first(Neural2)
        // for whichever tiers that language actually has. Strictly stronger
        // than "any Chirp3 before any Neural2" — catches interleaving too.
        for (const [language, s] of byLanguage) {
            if (s.last[0] >= 0 && s.first[1] < Infinity) {
                expect(s.last[0], `${language}: Chirp3 HD must precede Chirp HD`).toBeLessThan(s.first[1]);
            }
            if (s.last[1] >= 0 && s.first[2] < Infinity) {
                expect(s.last[1], `${language}: Chirp HD must precede Neural2`).toBeLessThan(s.first[2]);
            }
            if (s.last[0] >= 0 && s.first[2] < Infinity) {
                expect(s.last[0], `${language}: Chirp3 HD must precede Neural2`).toBeLessThan(s.first[2]);
            }
        }
    });
});
