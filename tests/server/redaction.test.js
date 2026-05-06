// tests/server/redaction.test.js
//
// E5 — Data classification & redaction policy contract tests.
//
// Locks in the observed behaviour of `server/redaction.js`. This file is a
// pure-function module: no DB, no I/O, no network. We exercise the public
// surface (`RESPONSE_REDACTION_POLICY`, `redactRow`, `redactRows`,
// `redactJsonColumn`, `redactPlatformSettingRows`, `redactAuditPayload`)
// against the policy table and the regex `SECRET_KEY_PATTERN`.
//
// CONTRACT (observed at server/redaction.js v1, REDACTED = '[redacted]'):
//
// 1. Redaction marker is the literal string `'[redacted]'` (exported as
//    `REDACTED`, but consumed here via direct string comparison so the
//    test fails loudly if the marker ever changes).
//
// 2. Secrets policy:
//      - `apiKey`, `api_key`, `llm_api_key` => action 'redact' =>
//        value replaced with `'[redacted]'` when truthy, left as-is when
//        falsy (null / '' / 0 short-circuit `value ? REDACTED : value`).
//      - `password_hash`, `token_hash`, `token`, `refresh_token` =>
//        action 'hide' => key removed from output object entirely
//        (redactValue returns undefined and redactRow skips undefined).
//      - Free-form keys matching SECRET_KEY_PATTERN (e.g. `secret`,
//        `auth_token`, `password`) and not in the explicit policy still
//        get redacted to `'[redacted]'` via shouldRedactKey().
//
// 3. PII policy is scope-gated by `classification.pii`:
//      - default scope is `'allow'` => PII values pass through unchanged.
//      - any non-'allow' scope (e.g. 'redact', 'cross-user', 'self') =>
//        email-class fields (`email`, `user_email`, `alternative_email`)
//        get the local part preserved and the domain replaced:
//        `'jane.doe@acme.com'` => `'jane.doe@[redacted]'`.
//        Other PII columns (`phone`, `address`, `name`, `student_name`,
//        `education`, `grade`) collapse to `'[redacted]'`.
//
// 4. Internal hidden keys are scope-gated by `classification.internal`:
//      - default `'allow'` => values pass through.
//      - non-'allow' => `created_by` / `updated_by` redacted to
//        `'[redacted]'`; `role_rank` removed from output entirely
//        (action 'hide').
//
// 5. redactJsonColumn:
//      - string input that JSON-parses to object/array => walks it
//        recursively and re-stringifies the result (round-trips through
//        JSON.stringify so output type matches input type).
//      - object/array input => walks recursively, returns object/array.
//      - non-JSON-looking strings (no leading `[` or `{`) => returned
//        as-is, even if they look like data.
//      - malformed JSON string starting with `{` => returned as the
//        original string (cloneJson catches the parse error).
//      - null / undefined => returned as null / undefined.
//      - Recursion redacts on key pattern match (`api_key`, `secret`,
//        `password`, `token`) at every depth.
//
// 6. redactPlatformSettingRows:
//      - `setting_key` itself is exempt (`shouldRedactKey` short-circuits
//        on the literal key 'setting_key').
//      - `setting_value` is redacted to `'[redacted]'` when the
//        setting_key matches SECRET_SETTING_KEY_PATTERN
//        (`*_api_key`, `*_secret`, `*_token`, etc.).
//      - For non-secret keys, `setting_value` is JSON-parsed (if a JSON
//        string) and walked through redactJsonColumn so nested API keys
//        inside the value are scrubbed.
//
// 7. redactAuditPayload:
//      - thin wrapper over redactJsonColumn; recursively scrubs nested
//        secrets in audit blobs (oldValue / newValue / metadata trees).
//
// 8. Idempotency: redactRow(redactRow(x)) === redactRow(x) (deep equal).
//    Once a value has been replaced with `'[redacted]'`, the second pass
//    sees the same key but the literal string still gets re-replaced
//    with `'[redacted]'`, which is a fixpoint.
//
// 9. Non-mutation: redactRow / redactJsonColumn return new objects; the
//    input row is left structurally intact (same keys, same values).

import { describe, it, expect } from 'vitest';
import {
    RESPONSE_REDACTION_POLICY,
    redactRow,
    redactRows,
    redactJsonColumn,
    redactPlatformSettingRows,
    redactAuditPayload
} from '../../server/redaction.js';

const MARK = '[redacted]';

describe('RESPONSE_REDACTION_POLICY (policy table shape)', () => {
    it('marks api keys as secret/redact and password_hash as secret/hide', () => {
        expect(RESPONSE_REDACTION_POLICY.api_key).toEqual({ class: 'secret', action: 'redact' });
        expect(RESPONSE_REDACTION_POLICY.apiKey).toEqual({ class: 'secret', action: 'redact' });
        expect(RESPONSE_REDACTION_POLICY.llm_api_key).toEqual({ class: 'secret', action: 'redact' });
        expect(RESPONSE_REDACTION_POLICY.password_hash).toEqual({ class: 'secret', action: 'hide' });
        expect(RESPONSE_REDACTION_POLICY.token_hash).toEqual({ class: 'secret', action: 'hide' });
    });

    it('marks email-class PII as mask-email-domain and other PII as redact', () => {
        expect(RESPONSE_REDACTION_POLICY.email.action).toBe('mask-email-domain');
        expect(RESPONSE_REDACTION_POLICY.user_email.action).toBe('mask-email-domain');
        expect(RESPONSE_REDACTION_POLICY.alternative_email.action).toBe('mask-email-domain');
        expect(RESPONSE_REDACTION_POLICY.phone).toEqual({ class: 'pii', action: 'redact' });
        expect(RESPONSE_REDACTION_POLICY.role_rank).toEqual({ class: 'internal', action: 'hide' });
    });
});

describe('redactRow — secrets', () => {
    it('replaces apiKey/api_key/llm_api_key with the [redacted] marker', () => {
        const out = redactRow({
            id: 1,
            apiKey: 'sk-live-abc',
            api_key: 'sk-live-def',
            llm_api_key: 'sk-live-ghi'
        });
        expect(out.apiKey).toBe(MARK);
        expect(out.api_key).toBe(MARK);
        expect(out.llm_api_key).toBe(MARK);
        expect(out.id).toBe(1);
    });

    it('removes password_hash and token_hash entirely (action: hide)', () => {
        const out = redactRow({
            id: 1,
            email: 'a@b.com',
            password_hash: 'argon2$xxx',
            token_hash: 'tok_abc',
            refresh_token: 'rt_abc'
        });
        expect('password_hash' in out).toBe(false);
        expect('token_hash' in out).toBe(false);
        expect('refresh_token' in out).toBe(false);
        expect(out.id).toBe(1);
    });

    it('redacts free-form secret-pattern keys (custom_secret, my_token, password)', () => {
        const out = redactRow({
            id: 1,
            custom_secret: 'shh',
            my_token: 'tok',
            user_password: 'plain'
        });
        expect(out.custom_secret).toBe(MARK);
        expect(out.my_token).toBe(MARK);
        expect(out.user_password).toBe(MARK);
    });

    it('preserves falsy secret values rather than emitting [redacted]', () => {
        const out = redactRow({ apiKey: '', api_key: null });
        // value ? REDACTED : value short-circuits on falsy.
        expect(out.apiKey).toBe('');
        expect(out.api_key).toBe(null);
    });
});

describe('redactRow — PII scope', () => {
    it('default scope (pii: allow) leaves email/phone/name untouched', () => {
        const row = { email: 'jane@acme.com', phone: '+1-555', name: 'Jane', address: '1 Main St' };
        expect(redactRow(row)).toEqual(row);
    });

    it('pii: redact masks email domain and collapses phone/name/address', () => {
        const out = redactRow(
            { email: 'jane@acme.com', phone: '+1-555', name: 'Jane', address: '1 Main' },
            { pii: 'redact' }
        );
        expect(out.email).toBe(`jane@${MARK}`);
        expect(out.phone).toBe(MARK);
        expect(out.name).toBe(MARK);
        expect(out.address).toBe(MARK);
    });

    it('pii: cross-user (any non-allow value) triggers the same redaction path', () => {
        const out = redactRow(
            { user_email: 'x@y.com', alternative_email: 'b@c.com', grade: 'A', education: 'PhD' },
            { pii: 'cross-user' }
        );
        expect(out.user_email).toBe(`x@${MARK}`);
        expect(out.alternative_email).toBe(`b@${MARK}`);
        expect(out.grade).toBe(MARK);
        expect(out.education).toBe(MARK);
    });

    it('pii: self also redacts (only the literal string "allow" passes PII through)', () => {
        const out = redactRow({ email: 'a@b.com', name: 'Bob' }, { pii: 'self' });
        expect(out.email).toBe(`a@${MARK}`);
        expect(out.name).toBe(MARK);
    });

    it('redacts PII columns from PII_COLUMNS that are not in the policy table (student_name)', () => {
        const out = redactRow({ student_name: 'Alex Q' }, { pii: 'redact' });
        expect(out.student_name).toBe(MARK);
    });
});

describe('redactRow — internal hidden keys', () => {
    it('default scope (internal: allow) leaves created_by/updated_by/role_rank in place', () => {
        const row = { created_by: 7, updated_by: 8, role_rank: 99 };
        expect(redactRow(row)).toEqual(row);
    });

    it('internal: redact replaces created_by/updated_by with [redacted] and removes role_rank', () => {
        const out = redactRow(
            { id: 1, created_by: 7, updated_by: 8, role_rank: 99 },
            { internal: 'redact' }
        );
        expect(out.created_by).toBe(MARK);
        expect(out.updated_by).toBe(MARK);
        expect('role_rank' in out).toBe(false);
        expect(out.id).toBe(1);
    });
});

describe('redactJsonColumn', () => {
    it('walks nested objects and redacts deep api_key/secret/password leaves', () => {
        const input = { a: { b: { c: { api_key: 'sk-xxx', ok: 1 } } }, secret: 'shh', password: 'p' };
        const out = redactJsonColumn(input);
        expect(out.a.b.c.api_key).toBe(MARK);
        expect(out.a.b.c.ok).toBe(1);
        expect(out.secret).toBe(MARK);
        expect(out.password).toBe(MARK);
    });

    it('walks arrays of objects and redacts each element', () => {
        const input = [{ api_key: 'one' }, { api_key: 'two', label: 'keep' }];
        const out = redactJsonColumn(input);
        expect(out[0].api_key).toBe(MARK);
        expect(out[1].api_key).toBe(MARK);
        expect(out[1].label).toBe('keep');
    });

    it('parses JSON-string input and re-stringifies the redacted result', () => {
        const json = JSON.stringify({ providers: [{ name: 'openai', api_key: 'sk-1' }] });
        const out = redactJsonColumn(json);
        expect(typeof out).toBe('string');
        const reparsed = JSON.parse(out);
        expect(reparsed.providers[0].api_key).toBe(MARK);
        expect(reparsed.providers[0].name).toBe('openai');
    });

    it('returns null/undefined unchanged and passes scalar strings through', () => {
        expect(redactJsonColumn(null)).toBe(null);
        expect(redactJsonColumn(undefined)).toBe(undefined);
        // Non-JSON-looking string: no leading [ or {, so returned as-is.
        expect(redactJsonColumn('hello world')).toBe('hello world');
    });

    it('returns malformed JSON string unchanged (parse failure falls back to original)', () => {
        const broken = '{ not really json';
        expect(redactJsonColumn(broken)).toBe(broken);
    });
});

describe('redactPlatformSettingRows', () => {
    it('redacts setting_value for *_api_key / *_secret / *_token keys', () => {
        const rows = [
            { setting_key: 'openai_api_key', setting_value: 'sk-live' },
            { setting_key: 'jwt_secret', setting_value: 'super' },
            { setting_key: 'webhook_token', setting_value: 'tok' }
        ];
        const out = redactPlatformSettingRows(rows);
        expect(out[0].setting_value).toBe(MARK);
        expect(out[1].setting_value).toBe(MARK);
        expect(out[2].setting_value).toBe(MARK);
        // setting_key itself is preserved (shouldRedactKey exempts it).
        expect(out[0].setting_key).toBe('openai_api_key');
    });

    it('walks JSON-valued setting_value for non-secret keys and redacts inner api_key', () => {
        const rows = [{
            setting_key: 'llm_settings',
            setting_value: JSON.stringify({ model: 'gpt-4', api_key: 'sk-inner' })
        }];
        const out = redactPlatformSettingRows(rows);
        // Non-secret key => parsed object returned (not re-stringified, because
        // parseJsonValue handed an object to redactJsonColumn).
        expect(out[0].setting_value.model).toBe('gpt-4');
        expect(out[0].setting_value.api_key).toBe(MARK);
    });
});

describe('redactAuditPayload', () => {
    it('recursively scrubs api_key/secret deep inside audit oldValue/newValue/metadata trees', () => {
        const payload = {
            oldValue: { llm: { provider: 'openai', api_key: 'old-key' } },
            newValue: { llm: { provider: 'anthropic', api_key: 'new-key' } },
            metadata: { actor: 'admin', token: 'tok-xyz', nested: { secret: 'shh' } }
        };
        const out = redactAuditPayload(payload);
        expect(out.oldValue.llm.api_key).toBe(MARK);
        expect(out.newValue.llm.api_key).toBe(MARK);
        expect(out.metadata.token).toBe(MARK);
        expect(out.metadata.nested.secret).toBe(MARK);
        expect(out.metadata.actor).toBe('admin');
    });
});

describe('redactRows + idempotency + non-mutation', () => {
    it('redactRows applies redactRow across an array', () => {
        const rows = [
            { id: 1, api_key: 'a', email: 'x@y.com' },
            { id: 2, api_key: 'b', email: 'p@q.com' }
        ];
        const out = redactRows(rows, { pii: 'redact' });
        expect(out).toHaveLength(2);
        expect(out[0].api_key).toBe(MARK);
        expect(out[1].api_key).toBe(MARK);
        expect(out[0].email).toBe(`x@${MARK}`);
        expect(out[1].email).toBe(`p@${MARK}`);
    });

    it('redactRows tolerates null/undefined input by returning []', () => {
        expect(redactRows(null)).toEqual([]);
        expect(redactRows(undefined)).toEqual([]);
    });

    it('is idempotent: redactRow(redactRow(x)) deep-equals redactRow(x)', () => {
        const row = {
            id: 1,
            api_key: 'sk-abc',
            password_hash: 'argon$x',
            email: 'jane@acme.com',
            created_by: 7,
            role_rank: 5
        };
        const once = redactRow(row, { pii: 'redact', internal: 'redact' });
        const twice = redactRow(once, { pii: 'redact', internal: 'redact' });
        expect(twice).toEqual(once);
    });

    it('does not mutate the input row object', () => {
        const row = { api_key: 'sk-abc', email: 'a@b.com', password_hash: 'h' };
        const snapshot = { ...row };
        const out = redactRow(row, { pii: 'redact' });
        expect(row).toEqual(snapshot);
        // And the output is a fresh object reference.
        expect(out).not.toBe(row);
    });
});
