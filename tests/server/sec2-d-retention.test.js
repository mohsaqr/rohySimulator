// Security fix pass 2026-10-26, lane D — retention.
//
// Regression lock: Settings → Oyon "Retention (days)" was never applied — nothing scheduled the sweep, and the sweep covered only oyon_emotion_records, never oyon_signal_windows or oyon_signal_events (F-33 / L7-06). Identifier logs had no retention at all; they now have opt-in horizons, and each user's latest terms acceptance is always kept.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

const ctx = await createTestDb({ label: 'd-retention' });
process.env.ROHY_DB = ctx.dbPath;
process.env.ROHY_NO_AUTO_SEED = '1';
process.env.ROHY_BACKUP_BEFORE_MIGRATE = '0';
const { runRetentionSweep, startRetentionScheduler } = await import('../../server/lib/retention.js');

const store = { all: (sql, p) => ctx.all(sql, p), run: (sql, p) => ctx.run(sql, p) };
const OLD = '2025-01-01T00:00:00.000Z';
const NEW = new Date().toISOString();

describe('retention sweep (lane D)', () => {
    beforeAll(async () => {
        const r = ctx.run;
        await r('PRAGMA foreign_keys = OFF');
        await r(`INSERT INTO oyon_settings (tenant_id, retention_days) VALUES ('1', 30), ('2', NULL)`);
        for (const tenant of ['1', '2']) {
            for (const ts of [OLD, NEW]) {
                await r(`INSERT INTO oyon_emotion_records (tenant_id, user_id, session_id, window_start, window_end, capture_mode, consent_version, valid_frames, missing_face_ratio)
                         VALUES (?, '7', '1', ?, ?, 'local-browser', 'v1', 1, 0)`, [tenant, ts, ts]);
                await r(`INSERT INTO oyon_signal_windows (tenant_id, user_id, session_id, modality, window_kind, window_start, window_end, consent_version)
                         VALUES (?, '7', '1', 'typing', 'episode', ?, ?, 'v2')`, [tenant, ts, ts]);
                await r(`INSERT INTO oyon_signal_events (tenant_id, user_id, session_id, capture_id, sequence_index, modality, state, source, occurred_at, consent_version)
                         VALUES (?, '7', '1', ?, 0, 'typing', 'insert', 'user', ?, 'v2')`, [tenant, `c-${tenant}-${ts}`, ts]);
            }
        }
        await r(`INSERT INTO login_logs (username, action, timestamp, tenant_id) VALUES ('a', 'login', '2025-01-01 00:00:00', 1), ('b', 'login', CURRENT_TIMESTAMP, 1)`);
        await r(`INSERT INTO terms_acceptances (tenant_id, user_id, version, title, body, accepted_at) VALUES
                 (1, 7, 'v1', 't', 'b', '2025-01-01 00:00:00'), (1, 7, 'v2', 't', 'b', '2025-02-01 00:00:00'),
                 (1, 8, 'v1', 't', 'b', '2025-01-01 00:00:00')`);
    });

    afterAll(() => ctx.cleanup());

    it('applies a tenant\'s Oyon retention to all three Oyon tables, and leaves other tenants alone', async () => {
        const summary = await runRetentionSweep({ store, env: {} });
        expect(summary.oyon['1']).toEqual({ oyon_emotion_records: 1, oyon_signal_windows: 1, oyon_signal_events: 1 });
        expect(summary.oyon['2']).toBeUndefined();
        for (const table of ['oyon_emotion_records', 'oyon_signal_windows', 'oyon_signal_events']) {
            const rows = await ctx.all(`SELECT tenant_id FROM ${table} ORDER BY tenant_id`);
            expect(rows.map((x) => x.tenant_id), table).toEqual(['1', '2', '2']);
        }
        // Identifier-log retention is off unless the operator sets it.
        expect(summary.login_logs).toBeNull();
        expect((await ctx.get('SELECT COUNT(*) AS n FROM login_logs')).n).toBe(2);
    });

    it('applies opt-in horizons to login logs and superseded terms acceptances, keeping each latest acceptance', async () => {
        const summary = await runRetentionSweep({ store, env: { ROHY_RETENTION_LOGIN_LOGS_DAYS: '90', ROHY_RETENTION_TERMS_ACCEPTANCES_DAYS: '90' } });
        expect(summary.login_logs).toBe(1);
        expect(summary.terms_acceptances).toBe(1);
        const kept = await ctx.all('SELECT user_id, version FROM terms_acceptances ORDER BY user_id, version');
        expect(kept).toEqual([{ user_id: 7, version: 'v2' }, { user_id: 8, version: 'v1' }]);
    });

    it('the scheduler is unref\'d, can be switched off, and runs on its timer', async () => {
        expect(startRetentionScheduler({ env: { ROHY_RETENTION_SCHEDULER: '0' } }).enabled).toBe(false);
        vi.useFakeTimers();
        try {
            const handle = startRetentionScheduler({ env: {}, initialDelayMs: 1000, intervalMs: 60_000, random: () => 0.5 });
            expect(handle.enabled).toBe(true);
            handle.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});
