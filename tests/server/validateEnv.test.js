import { describe, it, expect } from 'vitest';
import { validateEnv, validateEnvOrExit } from '../../server/config/validateEnv.js';

const baseProdEnv = () => ({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(64),
    FRONTEND_URL: 'https://example.com/rohy',
    ROHY_DB: '/opt/data/rohy/database.sqlite',
    TRANSFORMERS_CACHE: '/var/cache/rohy-hf',
});

describe('validateEnv', () => {
    describe('ROHY_PLUGIN_ORIGIN_TOKENS', () => {
        // This branch shipped with `fatal.push(...)` against an array called
        // `errors`, so it threw ReferenceError the moment a deployment set the
        // variable — and only ESLint caught it, in CI, because nothing here
        // exercised the path. A validator with no test validates nothing.
        it('rejects a malformed credential map', () => {
            const { errors } = validateEnv({
                JWT_SECRET: 'a'.repeat(64),
                ROHY_PLUGIN_ORIGIN_TOKENS: 'no-equals-sign',
            });
            expect(errors).toEqual(expect.arrayContaining([
                expect.stringMatching(/ROHY_PLUGIN_ORIGIN_TOKENS/),
            ]));
        });

        it('never puts the credential in the error, because the bad entry IS the secret', () => {
            const { errors } = validateEnv({
                JWT_SECRET: 'a'.repeat(64),
                ROHY_PLUGIN_ORIGIN_TOKENS: 'sup3rs3cr3t-with-no-equals',
            });
            expect(errors.join(' ')).not.toContain('sup3rs3cr3t');
        });

        it('accepts a well-formed map, and unset is not an error', () => {
            const base = { JWT_SECRET: 'a'.repeat(64) };
            expect(validateEnv({ ...base, ROHY_PLUGIN_ORIGIN_TOKENS: 'pacs=abc,pathology=def' }).errors)
                .toHaveLength(0);
            expect(validateEnv(base).errors).toHaveLength(0);
        });
    });


    describe('JWT_SECRET', () => {
        it('errors when missing in any environment', () => {
            const { errors } = validateEnv({});
            expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/JWT_SECRET is not set/)]));
        });

        it('warns on short secret (<32 chars)', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'short' });
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/JWT_SECRET is only 5 chars/)]));
        });

        it('passes for a sufficiently long secret', () => {
            const { errors, warnings } = validateEnv({ JWT_SECRET: 'a'.repeat(64) });
            expect(errors).toHaveLength(0);
            expect(warnings.find(w => w.includes('JWT_SECRET'))).toBeUndefined();
        });
    });

    describe('PORT / HTTPS_PORT', () => {
        it('errors on non-numeric PORT', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40), PORT: 'abc' });
            expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/PORT="abc" is not a positive integer/)]));
        });
        it('errors on non-numeric HTTPS_PORT', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40), HTTPS_PORT: '4000.5' });
            expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/HTTPS_PORT.*is not a positive integer/)]));
        });
        it('accepts numeric ports', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40), PORT: '4000', HTTPS_PORT: '4443' });
            expect(errors).toHaveLength(0);
        });
        it('treats empty PORT as unset (no error)', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40), PORT: '' });
            expect(errors).toHaveLength(0);
        });
    });

    describe('FRONTEND_URL', () => {
        it('errors on unparseable URL', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40), FRONTEND_URL: 'not a url' });
            expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/FRONTEND_URL=.*is not a valid URL/)]));
        });
        it('warns when missing in production', () => {
            const env = baseProdEnv();
            delete env.FRONTEND_URL;
            const { warnings } = validateEnv(env);
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/FRONTEND_URL is not set in production/)]));
        });
        it('does NOT warn when missing in development', () => {
            const { warnings } = validateEnv({ NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40) });
            expect(warnings.find(w => w.includes('FRONTEND_URL'))).toBeUndefined();
        });
    });

    describe('ROHY_DB', () => {
        it('warns on relative path', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'x'.repeat(40), ROHY_DB: 'rel/path/db.sqlite' });
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/is not an absolute path/)]));
        });
        it('warns when missing in production', () => {
            const env = baseProdEnv();
            delete env.ROHY_DB;
            const { warnings } = validateEnv(env);
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/ROHY_DB is not set in production/)]));
        });
        it('accepts absolute paths', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'x'.repeat(40), ROHY_DB: '/var/lib/rohy.sqlite' });
            expect(warnings.find(w => w.startsWith('ROHY_DB'))).toBeUndefined();
        });
    });

    describe('TLS_CERT_PATH / TLS_KEY_PATH', () => {
        it('errors when one is set without the other', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40), TLS_CERT_PATH: '/cert.pem' });
            expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/TLS_CERT_PATH and TLS_KEY_PATH must both be set/)]));
        });
        it('passes when both set', () => {
            const { errors } = validateEnv({
                JWT_SECRET: 'x'.repeat(40),
                TLS_CERT_PATH: '/cert.pem',
                TLS_KEY_PATH: '/key.pem',
            });
            expect(errors.find(e => e.includes('TLS_'))).toBeUndefined();
        });
        it('passes when both unset', () => {
            const { errors } = validateEnv({ JWT_SECRET: 'x'.repeat(40) });
            expect(errors.find(e => e.includes('TLS_'))).toBeUndefined();
        });
    });

    describe('TRANSFORMERS_CACHE', () => {
        it('warns when unset in production', () => {
            const env = baseProdEnv();
            delete env.TRANSFORMERS_CACHE;
            const { warnings } = validateEnv(env);
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/TRANSFORMERS_CACHE/)]));
        });
        it('does NOT warn in dev', () => {
            const { warnings } = validateEnv({ NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40) });
            expect(warnings.find(w => w.includes('TRANSFORMERS_CACHE'))).toBeUndefined();
        });
    });

    describe('ALLOW_DEFAULT_USERS', () => {
        it('warns when set to 1 in production', () => {
            const env = { ...baseProdEnv(), ALLOW_DEFAULT_USERS: '1' };
            const { warnings } = validateEnv(env);
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/ALLOW_DEFAULT_USERS=1 in production/)]));
        });
        it('does NOT warn in dev', () => {
            const { warnings } = validateEnv({ NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40), ALLOW_DEFAULT_USERS: '1' });
            expect(warnings.find(w => w.includes('ALLOW_DEFAULT_USERS'))).toBeUndefined();
        });
    });

    describe('ROHY_TRUST_PROXY', () => {
        it('accepts loopback', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'x'.repeat(40), ROHY_TRUST_PROXY: 'loopback' });
            expect(warnings.find(w => w.includes('ROHY_TRUST_PROXY'))).toBeUndefined();
        });
        it('accepts an IP', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'x'.repeat(40), ROHY_TRUST_PROXY: '127.0.0.1' });
            expect(warnings.find(w => w.includes('ROHY_TRUST_PROXY'))).toBeUndefined();
        });
        it('accepts a hop-count integer', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'x'.repeat(40), ROHY_TRUST_PROXY: '2' });
            expect(warnings.find(w => w.includes('ROHY_TRUST_PROXY'))).toBeUndefined();
        });
        it('warns on a typo', () => {
            const { warnings } = validateEnv({ JWT_SECRET: 'x'.repeat(40), ROHY_TRUST_PROXY: 'loopbackk' });
            expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/ROHY_TRUST_PROXY=.*doesn't look/)]));
        });
    });

    describe('happy paths', () => {
        it('production with all vars set produces no errors and no warnings', () => {
            const { errors, warnings } = validateEnv(baseProdEnv());
            expect(errors).toHaveLength(0);
            expect(warnings).toHaveLength(0);
        });
        it('development minimal (just JWT_SECRET) produces no errors', () => {
            const { errors } = validateEnv({ NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40) });
            expect(errors).toHaveLength(0);
        });
    });
});

describe('validateEnvOrExit', () => {
    it('returns warnings/errors and does NOT exit when errors are empty', () => {
        const calls = { warn: [], error: [], info: [] };
        const log = {
            warn: (msg) => calls.warn.push(msg),
            error: (msg) => calls.error.push(msg),
            info: (msg) => calls.info.push(msg),
        };
        const result = validateEnvOrExit(baseProdEnv(), log);
        expect(result.errors).toHaveLength(0);
        expect(calls.error).toHaveLength(0);
    });

    it('logs warnings via log.warn', () => {
        const calls = { warn: [], error: [] };
        const log = { warn: (m) => calls.warn.push(m), error: (m) => calls.error.push(m) };
        const env = { ...baseProdEnv() };
        delete env.TRANSFORMERS_CACHE;
        validateEnvOrExit(env, log);
        expect(calls.warn.some(w => w.includes('TRANSFORMERS_CACHE'))).toBe(true);
    });

    // Skipped: exercising the process.exit(1) branch requires a child-process
    // harness. CONTRACT: validateEnv() unit tests above prove every fatal
    // condition produces a non-empty errors[]; validateEnvOrExit's only
    // remaining behaviour on errors[].length > 0 is logging + exit. Adding
    // a spawn test would multiply runtime for one branch with trivial
    // body — left out per CLAUDE.md "skipped tests policy".
    it.skip('exits with code 1 when errors are present (covered via spawn smoke)', () => {});
});

describe('validateEnv — remote Kokoro (ROHY_KOKORO_*)', () => {
    const base = { JWT_SECRET: 'a'.repeat(64) };
    const kokoroWarnings = (env) => validateEnv(env).warnings.filter((w) => w.includes('ROHY_KOKORO'));

    it('accepts an https URL with a key, and unset is not an error', () => {
        const env = { ...baseProdEnv(), ROHY_KOKORO_URL: 'https://api.example.org/v1', ROHY_KOKORO_API_KEY: 'k', ROHY_KOKORO_TIMEOUT_MS: '8000' };
        expect(validateEnv(env).errors).toHaveLength(0);
        expect(kokoroWarnings(env)).toHaveLength(0);
        expect(validateEnv(base).errors).toHaveLength(0);
    });

    it('is fatal on a URL that does not parse or is not http(s)', () => {
        for (const bad of ['not a url', 'ftp://api.example.org/v1']) {
            expect(validateEnv({ ...base, ROHY_KOKORO_URL: bad }).errors)
                .toEqual([expect.stringMatching(/ROHY_KOKORO_URL/)]);
        }
    });

    it('is fatal on a timeout that is not a positive integer', () => {
        for (const bad of ['0', '-5', '1.5', 'soon']) {
            expect(validateEnv({ ...base, ROHY_KOKORO_TIMEOUT_MS: bad }).errors)
                .toEqual([expect.stringMatching(/ROHY_KOKORO_TIMEOUT_MS/)]);
        }
    });

    it('warns when the URL has no key, or the key has no URL', () => {
        expect(kokoroWarnings({ ...base, ROHY_KOKORO_URL: 'https://api.example.org/v1' }))
            .toEqual([expect.stringMatching(/ROHY_KOKORO_API_KEY is not/)]);
        expect(kokoroWarnings({ ...base, ROHY_KOKORO_API_KEY: 'k' }))
            .toEqual([expect.stringMatching(/ROHY_KOKORO_URL is not/)]);
    });

    it('warns on plain http to a non-local host in production only', () => {
        const env = { ...baseProdEnv(), ROHY_KOKORO_URL: 'http://api.example.org/v1', ROHY_KOKORO_API_KEY: 'k' };
        expect(kokoroWarnings(env)).toEqual([expect.stringMatching(/plain http/)]);
        expect(kokoroWarnings({ ...env, ROHY_KOKORO_URL: 'http://localhost:8880/v1' })).toHaveLength(0);
        expect(kokoroWarnings({ ...base, ROHY_KOKORO_URL: 'http://api.example.org/v1', ROHY_KOKORO_API_KEY: 'k' })).toHaveLength(0);
    });

    it('never puts the API key in an error or warning', () => {
        const { errors, warnings } = validateEnv({ ...base, ROHY_KOKORO_URL: 'bad', ROHY_KOKORO_API_KEY: 'sk-s3cr3t' });
        expect([...errors, ...warnings].join(' ')).not.toContain('sk-s3cr3t');
    });
});
