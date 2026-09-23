// The database is in WAL mode before the server answers its first request.
//
// dbAdapter.js is written for WAL, but until 2026-09-23 nothing set it until
// the audit chain's connection opened on the first AUDITED write — measured: a
// fresh server's database read `journal_mode = delete` after boot and after a
// login. A new database therefore served its first requests in rollback-journal
// mode, where a read on the shared handle waits out its 1 s busy timeout and
// fails SQLITE_BUSY while the other connection commits or switches the journal.
// That matches the one CI failure of users-preferences-merge.test.js (a GET
// right after the first audited PUT answered an error, in ~1 s). server/db.js
// now switches to WAL at the end of boot, while it is the only connection.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { closeDb, get, openDb } from '../utils/authHttp.js';

describe('sqlite journal mode at boot', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    // Regression lock: a fresh database stayed in rollback-journal mode until
    // the first audited write.
    it('is WAL before any request has been made', async () => {
        const db = await openDb(server.dbPath);
        try {
            const row = await get(db, 'PRAGMA journal_mode');
            expect(row.journal_mode).toBe('wal');
        } finally {
            await closeDb(db);
        }
    });
});
