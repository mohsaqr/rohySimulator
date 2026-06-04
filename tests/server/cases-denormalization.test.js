// tests/server/cases-denormalization.test.js
//
// Bug 04.06.2026 #2 regression — the denormalized `chief_complaint` /
// `patient_name` columns on `cases` must be populated from the shape the
// case editor actually writes:
//
//     config.patient_name                       -> cases.patient_name
//     config.structuredHistory.chiefComplaint   -> cases.chief_complaint
//
// Before the fix the POST/PUT handlers read `config.demographics.name` and
// `config.chiefComplaint` (neither of which the editor sets), so the columns
// were left NULL for editor-created cases. The debrief card then fell back to
// `activeCase.description` and rendered the patient's name in the CHIEF
// COMPLAINT slot.
//
// We use the spawned-server harness (same approach as case-agents-merge) and
// read the DB row back directly to assert the column values.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => {
            if (err) reject(err); else resolve(db);
        });
    });
}

function closeDb(db) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        db.close(() => resolve());
    });
}

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
            if (err) reject(err); else resolve(this);
        })
    );
}

function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => {
            if (err) reject(err); else resolve(row);
        })
    );
}

const ADMIN_USERNAME = 'cc-admin';
const ADMIN_PASSWORD = 'cc-admin-pw-1';

describe('POST/PUT /api/cases — chief_complaint + patient_name denormalization', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(ADMIN_PASSWORD, 4);
            await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
                [ADMIN_USERNAME, 'CC Admin', 'cc-admin@example.com', hash]
            );
        } finally {
            await closeDb(db);
        }

        const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
        });
        expect(loginRes.status).toBe(200);
        token = (await loginRes.json()).token;
        expect(typeof token).toBe('string');
    }, 30_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    async function createCase(body) {
        const res = await fetch(`${server.baseUrl}/api/cases`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        return { res, body: await res.json() };
    }

    async function readRow(caseId) {
        const db = await openDb(server.dbPath);
        try {
            return await pGet(db, `SELECT patient_name, chief_complaint FROM cases WHERE id = ?`, [caseId]);
        } finally {
            await closeDb(db);
        }
    }

    it('populates the columns from the editor config shape (patient_name + structuredHistory.chiefComplaint)', async () => {
        const { res, body } = await createCase({
            name: 'Thomas Taylor',
            description: 'Thomas Taylor', // selection blurb == name, the trap
            config: {
                patient_name: 'Thomas Taylor',
                // Schema CHECK constraint requires capitalized gender values.
                demographics: { gender: 'Male', age: 69 },
                structuredHistory: { chiefComplaint: 'Chest pain for 2 hours' },
            },
        });
        expect(res.status).toBe(200);
        const row = await readRow(body.id);
        expect(row.patient_name).toBe('Thomas Taylor');
        // The column must be the complaint, NOT the name/description.
        expect(row.chief_complaint).toBe('Chest pain for 2 hours');
    });

    it('still honours the legacy demographics.name / config.chiefComplaint fallbacks', async () => {
        const { res, body } = await createCase({
            name: 'Legacy Case',
            description: 'desc',
            config: {
                demographics: { name: 'Jane Legacy', gender: 'Female', age: 40 },
                chiefComplaint: 'Headache',
            },
        });
        expect(res.status).toBe(200);
        const row = await readRow(body.id);
        expect(row.patient_name).toBe('Jane Legacy');
        expect(row.chief_complaint).toBe('Headache');
    });

    it('PUT updates the columns from the editor config shape', async () => {
        const { body: created } = await createCase({
            name: 'Edit Me',
            description: 'desc',
            config: { patient_name: 'Old Name', structuredHistory: { chiefComplaint: 'Old complaint' } },
        });
        const putRes = await fetch(`${server.baseUrl}/api/cases/${created.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
                name: 'Edit Me',
                description: 'desc',
                config: { patient_name: 'New Name', structuredHistory: { chiefComplaint: 'New complaint' } },
            }),
        });
        expect(putRes.status).toBe(200);
        const row = await readRow(created.id);
        expect(row.patient_name).toBe('New Name');
        expect(row.chief_complaint).toBe('New complaint');
    });
});
