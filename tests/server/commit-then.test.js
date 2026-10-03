// Regression lock: write routes answered before their COMMIT landed (users-rank-guard CI flake, v3.0.0-rc.3)
//
// Six handlers ended a transaction with a bare `dbAdapter.run('COMMIT')`
// followed at once by `auditSuccess()` and `res.json()`. The driver queues
// the COMMIT, so the 2xx went out first: a reader on another connection could
// still see the old rows (tests/server/users-rank-guard.test.js read a
// deleted user's cohort membership back on a slow CI runner), and the audit
// chain recorded a success for a change that might never commit.
//
// This suite locks:
//   - commitThen() runs the audit + response only after COMMIT's callback,
//   - a failed COMMIT rolls back, answers 500 COMMIT_FAILED, and never runs
//     the success path,
//   - no route file ends a transaction with a bare run('COMMIT') again.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const calls = [];

vi.mock('../../server/dbAdapter.js', () => {
    const run = (sql, params, callback) => {
        calls.push({ sql, callback });
    };
    return { default: { run, get: vi.fn(), all: vi.fn() }, run };
});

const { commitThen } = await import('../../server/routes/_helpers.js');

function fakeRes() {
    const res = {
        statusCode: 200,
        body: undefined,
        status: vi.fn((code) => { res.statusCode = code; return res; }),
        json: vi.fn((body) => { res.body = body; return res; }),
    };
    return res;
}

const req = { log: { error: vi.fn(), warn: vi.fn() } };

describe('commitThen', () => {
    beforeEach(() => { calls.length = 0; });

    it('waits for COMMIT before running the success path', () => {
        const res = fakeRes();
        const onCommitted = vi.fn(() => res.json({ ok: true }));

        commitThen(req, res, onCommitted);

        expect(calls.map((c) => c.sql)).toEqual(['COMMIT']);
        expect(onCommitted).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();

        calls[0].callback(null);

        expect(onCommitted).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ ok: true });
    });

    it('rolls back and answers 500 COMMIT_FAILED when COMMIT fails', () => {
        const res = fakeRes();
        const onCommitted = vi.fn();

        commitThen(req, res, onCommitted);
        calls[0].callback(new Error('SQLITE_BUSY: database is locked'));

        expect(onCommitted).not.toHaveBeenCalled();
        expect(calls.map((c) => c.sql)).toEqual(['COMMIT', 'ROLLBACK']);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: 'Could not save the change', code: 'COMMIT_FAILED' });
        expect(req.log.error).toHaveBeenCalled();
    });

    it('logs, not throws, when the follow-up ROLLBACK also fails', () => {
        const res = fakeRes();
        commitThen(req, res, vi.fn());
        calls[0].callback(new Error('disk I/O error'));
        expect(() => calls[1].callback(new Error('no transaction is active'))).not.toThrow();
        expect(req.log.warn).toHaveBeenCalled();
    });
});

describe('route files', () => {
    it('never end a transaction with a bare run(\'COMMIT\')', () => {
        const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server/routes');
        const offenders = fs.readdirSync(routesDir)
            .filter((name) => name.endsWith('.js') && name !== '_helpers.js')
            .flatMap((name) => fs.readFileSync(path.join(routesDir, name), 'utf8')
                .split('\n')
                .map((line, i) => ({ name, line: i + 1, text: line }))
                .filter(({ text }) => /\.run\(\s*['"]COMMIT['"]\s*\)/.test(text)))
            .map(({ name, line }) => `${name}:${line}`);
        expect(offenders).toEqual([]);
    });
});
