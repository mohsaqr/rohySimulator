import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentSqliteDb, runWithRequestContext } from '../../server/observability.js';

let db;
let stdoutSpy;
let stderrSpy;
let originalEnv;

function openMemoryDb() {
    return new Promise((resolve, reject) => {
        const handle = new sqlite3.Database(':memory:', (err) => {
            if (err) reject(err);
            else resolve(handle);
        });
    });
}

function closeDb(handle) {
    return new Promise((resolve) => handle.close(() => resolve()));
}

function run(handle, sql, params = []) {
    return new Promise((resolve, reject) => {
        handle.run(sql, params, function done(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(handle, sql, params = []) {
    return new Promise((resolve, reject) => {
        handle.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function captureStdout() {
    const writes = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return {
        clear() { writes.length = 0; },
        entries() {
            return writes
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        },
        dbEntries() {
            return this.entries().filter((entry) => entry.component === 'db');
        }
    };
}

describe('instrumentSqliteDb query logging', () => {
    beforeEach(async () => {
        originalEnv = { ...process.env };
        process.env.LOG_FORMAT = 'json';
        process.env.LOG_LEVEL = 'debug';
        process.env.NODE_ENV = 'test';
        db = instrumentSqliteDb(await openMemoryDb());
    });

    afterEach(async () => {
        stdoutSpy?.mockRestore();
        stderrSpy?.mockRestore();
        process.env = originalEnv;
        await closeDb(db);
    });

    it('emits debug query logs with request id, SQL summary, duration, and row counts', async () => {
        const cap = captureStdout();
        await run(db, 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password TEXT)');
        cap.clear();

        await runWithRequestContext({ request_id: 'db_req_123' }, async () => {
            await run(db, 'INSERT INTO users (email, password) VALUES (?, ?)', [
                'person@example.com',
                'secret-value'
            ]);
            await get(db, 'SELECT * FROM users WHERE email = ?', ['person@example.com']);
        });

        const entries = cap.dbEntries();
        expect(entries).toHaveLength(2);
        expect(entries[0]).toEqual(expect.objectContaining({
            level: 'debug',
            component: 'db',
            msg: 'sqlite query',
            operation: 'run',
            request_id: 'db_req_123',
            rows: 1,
        }));
        expect(entries[0].duration_ms).toEqual(expect.any(Number));
        expect(entries[0].sql_summary).toBe('INSERT INTO users (email, password) VALUES (?, ?)');

        expect(entries[1]).toEqual(expect.objectContaining({
            operation: 'get',
            rows: 1,
            request_id: 'db_req_123',
            sql_summary: 'SELECT * FROM users WHERE email = ?',
        }));
        expect(JSON.stringify(entries)).not.toContain('person@example.com');
        expect(JSON.stringify(entries)).not.toContain('secret-value');
    });
});
