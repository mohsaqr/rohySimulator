// Security fix pass 2026-10-26, lane D — the GDPR purge.
//
// Regression lock: the purge missed oyon_signal_windows / oyon_signal_events (keystroke and voice data, with the real name), registration_requests (name, e-mail, IP), terms_acceptances (IP, UA), cohort_members, lesson_progress, survey_responses and usage_budget, and its dry-run plan reported client_logs / learning_events_rejected as anonymised although the code never touched them (F-31 / L7-04). Plan and purge now come from ONE step list; this pins that they list the same tables and that each new table is handled.
// Regression lock: the pseudonym `deleted_user_<id>` kept the original id (L7-04); newPurgePseudonym is random and purgeAuditIdentity never carries the real username.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

const ctx = await createTestDb({ label: 'd-purge' });
process.env.ROHY_DB = ctx.dbPath;
process.env.ROHY_NO_AUTO_SEED = '1';
process.env.ROHY_BACKUP_BEFORE_MIGRATE = '0';
const { dbReady } = await import('../../server/db.js');
const helpers = await import('../../server/routes/_helpers.js');

const TENANT = 1;
const USER = 41;

describe('user purge (lane D)', () => {
    beforeAll(async () => {
        await dbReady;
        const r = ctx.run;
        // Fixture rows (a session on case 1) without the parents a real install
        // has; the migration handle has foreign keys on, the server's does not.
        await r('PRAGMA foreign_keys = OFF');
        await r(`INSERT INTO users (id, username, name, email, password_hash, role, tenant_id) VALUES (?, 'purge_me', 'Real Name', 'real@example.org', 'x', 'student', ?)`, [USER, TENANT]);
        await r(`INSERT INTO users (id, username, password_hash, role, tenant_id) VALUES (42, 'owner', 'x', 'educator', ?)`, [TENANT]);
        const cohort = (await r(`INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('C', 42, ?)`, [TENANT])).lastID;
        await r('INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)', [cohort, USER]);
        const lesson = (await r(`INSERT INTO lessons (cohort_id, title, tenant_id) VALUES (?, 'L', ?)`, [cohort, TENANT])).lastID;
        await r('INSERT INTO lesson_progress (user_id, lesson_id, cohort_id) VALUES (?, ?, ?)', [USER, lesson, cohort]);
        const survey = (await r(`INSERT INTO surveys (title, created_by_id, tenant_id) VALUES ('S', 42, ?)`, [TENANT])).lastID;
        await r(`INSERT INTO survey_responses (survey_id, user_id, dedupe_key) VALUES (?, ?, ?)`, [survey, USER, `u:${USER}:c:-`]);
        await r(`INSERT INTO usage_budget (tenant_id, user_id, provider, metric, window_start, window_end, used) VALUES (?, ?, 'p', 'm', '2026-10-01', '2026-10-02', 3)`, [TENANT, USER]);
        await r(`INSERT INTO terms_acceptances (tenant_id, user_id, version, title, body, ip_address, user_agent) VALUES (?, ?, 'v1', 't', 'b', '203.0.113.5', 'UA')`, [TENANT, USER]);
        await r(`INSERT INTO registration_requests (tenant_id, username, name, email, password_hash, status, ip_address, user_id) VALUES (?, 'purge_me', 'Real Name', 'real@example.org', 'h', 'approved', '203.0.113.5', ?)`, [TENANT, USER]);
        await r(`INSERT INTO registration_requests (tenant_id, username, name, email, password_hash, status, ip_address) VALUES (?, 'purge_me2', 'Real Name', 'REAL@example.org', 'h', 'rejected', '203.0.113.6')`, [TENANT]);
        const session = (await r(`INSERT INTO sessions (user_id, case_id, tenant_id, student_name) VALUES (?, 1, ?, 'Real Name')`, [USER, TENANT])).lastID;
        await r(`INSERT INTO oyon_signal_windows (tenant_id, user_id, session_id, modality, window_kind, window_start, window_end, student_name_snapshot, consent_version)
                 VALUES ('1', ?, ?, 'typing', 'episode', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:10.000Z', 'Real Name', 'v2')`, [String(USER), String(session)]);
        await r(`INSERT INTO oyon_signal_events (tenant_id, user_id, session_id, capture_id, sequence_index, modality, state, source, occurred_at, student_name_snapshot, consent_version)
                 VALUES ('1', ?, ?, 'c', 0, 'typing', 'insert', 'user', '2026-10-01T00:00:00.000Z', 'Real Name', 'v2')`, [String(USER), String(session)]);
        await r(`INSERT INTO client_logs (tenant_id, user_id, level, component, msg, ts) VALUES (?, ?, 'info', 'x', 'y', '2026-10-01T00:00:00.000Z')`, [TENANT, USER]);
        await r(`INSERT INTO learning_events_rejected (tenant_id, user_id, received_at, reason) VALUES (?, ?, '2026-10-01T00:00:00.000Z', 'unknown_verb')`, [TENANT, USER]);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('the dry-run plan lists exactly the tables the purge touches', async () => {
        const { plan, authoredCaseIds } = await helpers.buildUserPurgePlan(USER, TENANT);
        const planned = Object.entries(plan)
            .filter(([, v]) => v && typeof v === 'object')
            .flatMap(([category, tables]) => Object.keys(tables).map((t) => `${category}:${t}`))
            .sort();
        const { touched } = await helpers.executeUserPurge({
            userId: USER, tenant_id: TENANT, anonymizedUsername: helpers.newPurgePseudonym(), passwordHash: 'x', authoredCaseIds,
        });
        const executed = [...new Set(touched.map((t) => `${t.category}:${t.table}`))].sort();
        expect(executed).toEqual(planned);
        for (const required of ['hard_delete:oyon_signal_windows', 'hard_delete:oyon_signal_events', 'hard_delete:cohort_members',
            'hard_delete:lesson_progress', 'hard_delete:usage_budget', 'anonymize_retained:registration_requests',
            'anonymize_retained:terms_acceptances', 'anonymize_retained:survey_responses', 'anonymize_retained:client_logs',
            'anonymize_retained:learning_events_rejected']) {
            expect(planned, required).toContain(required);
        }
        expect(plan.hard_delete.oyon_signal_windows).toBe(1);
        expect(plan.anonymize_retained.registration_requests).toBe(2);
    });

    it('left nothing of the person in the new tables', async () => {
        const g = ctx.get;
        expect((await g(`SELECT COUNT(*) AS n FROM oyon_signal_windows WHERE user_id = ?`, [String(USER)])).n).toBe(0);
        expect((await g(`SELECT COUNT(*) AS n FROM oyon_signal_events WHERE user_id = ?`, [String(USER)])).n).toBe(0);
        expect((await g(`SELECT COUNT(*) AS n FROM cohort_members WHERE user_id = ?`, [USER])).n).toBe(0);
        expect((await g(`SELECT COUNT(*) AS n FROM lesson_progress WHERE user_id = ?`, [USER])).n).toBe(0);
        expect((await g(`SELECT COUNT(*) AS n FROM usage_budget WHERE user_id = ?`, [USER])).n).toBe(0);
        expect(await g(`SELECT user_id, dedupe_key FROM survey_responses`)).toEqual({ user_id: null, dedupe_key: null });
        expect(await g(`SELECT ip_address, user_agent, version FROM terms_acceptances WHERE user_id = ?`, [USER]))
            .toEqual({ ip_address: null, user_agent: null, version: 'v1' });
        const reqs = await ctx.all(`SELECT username, name, email, ip_address, user_id FROM registration_requests`);
        expect(reqs.length).toBe(2);
        for (const q of reqs) {
            expect(q).toMatchObject({ name: null, email: '', ip_address: null, user_id: null });
            expect(q.username).toMatch(/^deleted_user_[0-9a-f]{16}$/);
        }
        expect((await g(`SELECT COUNT(*) AS n FROM client_logs WHERE user_id = ?`, [USER])).n).toBe(0);
        expect((await g(`SELECT COUNT(*) AS n FROM learning_events_rejected WHERE user_id = ?`, [USER])).n).toBe(0);
        const user = await g('SELECT username, email, name FROM users WHERE id = ?', [USER]);
        expect(user.username).toMatch(/^deleted_user_[0-9a-f]{16}$/);
        expect(user.username).not.toBe(`deleted_user_${USER}`);
        expect(user.email).toBeNull();
    });

    it('the pseudonym and the audit identity never carry the id or the real username', () => {
        const a = helpers.newPurgePseudonym();
        const b = helpers.newPurgePseudonym();
        expect(a).not.toBe(b);
        const identity = helpers.purgeAuditIdentity({ username: 'purge_me' }, a);
        expect(JSON.stringify(identity)).not.toContain('purge_me');
        expect(identity).toMatchObject({ pseudonym: a, former_username_digest: expect.stringMatching(/^hmac:[0-9a-f]{32}$/) });
    });
});

// Keep the tmp dir tidy if createTestDb ever leaves siblings behind.
afterAll(() => {
    for (const d of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rohy-d-purge-'))) {
        try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch { /* best effort */ }
    }
});
