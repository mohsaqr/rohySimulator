// A database error never reaches a person as sqlite's own words (gate e2e
// under load, rc.47: "SQLITE_BUSY: database is locked" in a case-editor toast).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { dbErrorShield } from '../../server/middleware/dbErrorShield.js';

let server;
let base;

beforeAll(async () => {
    const app = express();
    app.use(dbErrorShield);
    app.get('/busy', (req, res) => res.status(500).json({ error: 'SQLITE_BUSY: database is locked' }));
    app.get('/constraint', (req, res) => res.status(500).json({ error: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: cases.name' }));
    app.get('/own', (req, res) => res.status(500).json({ error: 'Failed to save case' }));
    app.get('/client', (req, res) => res.status(400).json({ error: 'SQLITE_ looks odd but this is a 400' }));
    app.get('/ok', (req, res) => res.json({ rows: [1] }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

describe('dbErrorShield', () => {
    it('answers a busy database 503, retryable, in plain words', async () => {
        // Regression lock: the case editor showed "SQLITE_BUSY: database is locked"
        const { status, body } = await get('/busy');
        expect(status).toBe(503);
        expect(body).toMatchObject({ code: 'DB_BUSY', retryable: true });
        expect(body.error).not.toMatch(/SQLITE/);
    });

    it('hides any other sqlite text in a 5xx, keeping the status', async () => {
        const { status, body } = await get('/constraint');
        expect(status).toBe(500);
        expect(body.code).toBe('DB_ERROR');
        expect(JSON.stringify(body)).not.toMatch(/SQLITE|cases\.name/);
    });

    it('leaves a route\'s own messages, client errors and successes alone', async () => {
        expect(await get('/own')).toEqual({ status: 500, body: { error: 'Failed to save case' } });
        expect((await get('/client')).status).toBe(400);
        expect(await get('/ok')).toEqual({ status: 200, body: { rows: [1] } });
    });
});
