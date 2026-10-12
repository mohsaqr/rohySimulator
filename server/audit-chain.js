import crypto from 'node:crypto';

const LOGICAL_FIELDS = [
    'action',
    'ipAddress',
    'metadata',
    'newValue',
    'oldValue',
    'resourceId',
    'resourceName',
    'resourceType',
    'tenantId',
    'ts',
    'userAgent',
    'userId',
];

function dbGet(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function dbAll(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function dbRun(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function done(err) {
            err ? reject(err) : resolve(this);
        });
    });
}

// Audit appends go through the SHARED connection (db.js), like every other
// write. Until rc.48 they had a dedicated connection of their own, to keep a
// route's half-finished transaction on the shared handle from blocking them.
// The cost of that second writer showed under load (stability run, rc.47):
// in WAL mode each audit commit made every read in flight on the shared
// handle stale, and a write issued behind such a read is refused at once —
// SQLITE_BUSY whatever the timeout — so ordinary writes failed in bursts and
// lost learning events, orders and findings. An append is now one INSERT that
// carries its own chain check (see _appendAuditEntryUnlocked), so it needs no
// transaction of its own.
//
// The trade-off, accepted: an append that lands while a route has a
// transaction open on the shared handle joins that transaction, and if the
// route rolls back, the row goes with it — the same as any other request's
// write at that moment. The chain stays valid: everything appended in that
// window is undone together, and the next append reads the head that is left.
//
// Tests inject their own handle via `appendAuditEntry(row, { database })`.
async function defaultDb() {
    const mod = await import('./db.js');
    // Migrations create system_audit_log; wait for them before the first append.
    try { await mod.dbReady; } catch { /* primary boot failure surfaces elsewhere */ }
    return mod.default;
}

function parseJsonish(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = stableValue(value[key]);
            return acc;
        }, {});
    }
    return value ?? null;
}

function stableStringify(value) {
    return JSON.stringify(stableValue(value));
}

function serializeJsonish(value) {
    if (value == null) return null;
    return typeof value === 'string' ? value : stableStringify(value);
}

// resource_id and resource_name are TEXT columns: SQLite stores the number 12
// as the text "12" and reads it back as a string. The chain hashes them in that
// stored form, so what was hashed is what a verifier reads back.
const asStoredText = (value) => (value == null ? null : String(value));

function normalizeCanonicalInput(row) {
    return {
        userId: row.userId ?? row.user_id ?? null,
        action: row.action ?? null,
        resourceType: row.resourceType ?? row.resource_type ?? null,
        resourceId: asStoredText(row.resourceId ?? row.resource_id),
        resourceName: asStoredText(row.resourceName ?? row.resource_name),
        oldValue: parseJsonish(row.oldValue ?? row.old_value ?? null),
        newValue: parseJsonish(row.newValue ?? row.new_value ?? null),
        metadata: parseJsonish(row.metadata ?? null),
        tenantId: row.tenantId ?? row.tenant_id ?? null,
        ipAddress: row.ipAddress ?? row.ip_address ?? null,
        userAgent: row.userAgent ?? row.user_agent ?? null,
        ts: row.ts ?? row.timestamp ?? null,
    };
}

export function canonicalRow(row) {
    return canonicalJsonOf(normalizeCanonicalInput(row));
}

function canonicalJsonOf(normalized) {
    const sorted = {};
    for (const key of LOGICAL_FIELDS) {
        sorted[key] = stableValue(normalized[key]);
    }
    return JSON.stringify(sorted);
}

export function computeEntryHash(prevHash, canonicalJson) {
    return crypto
        .createHash('sha256')
        .update(`${prevHash ?? ''}${canonicalJson}`)
        .digest('hex');
}

// Per-handle schema-ensured cache. PRAGMA + ALTER ran inside the audit
// mutex on every append before this — head-of-line blocking on every
// fire-and-forget audit write. WeakMap so test fixtures with their own
// handles don't share cache entries with the prod singleton.
const schemaEnsured = new WeakMap();

export async function ensureAuditChainColumns(database) {
    if (schemaEnsured.get(database)) return;
    const columns = await dbAll(database, 'PRAGMA table_info(system_audit_log)');
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('prev_hash')) {
        await dbRun(database, 'ALTER TABLE system_audit_log ADD COLUMN prev_hash TEXT');
    }
    if (!names.has('entry_hash')) {
        await dbRun(database, 'ALTER TABLE system_audit_log ADD COLUMN entry_hash TEXT');
    }
    schemaEnsured.set(database, true);
}

export async function backfillAuditChain(database) {
    await ensureAuditChainColumns(database);
    const rows = await dbAll(
        database,
        `SELECT *
         FROM system_audit_log
         WHERE entry_hash IS NULL
         ORDER BY tenant_id, id`
    );
    let currentTenant = null;
    let prevHash = null;
    for (const row of rows) {
        if (row.tenant_id !== currentTenant) {
            currentTenant = row.tenant_id;
            const previous = await dbGet(
                database,
                `SELECT entry_hash
                 FROM system_audit_log
                 WHERE tenant_id = ? AND id < ? AND entry_hash IS NOT NULL
                 ORDER BY id DESC
                 LIMIT 1`,
                [row.tenant_id, row.id]
            );
            prevHash = previous?.entry_hash ?? null;
        }
        const canonicalJson = canonicalRow(row);
        const entryHash = computeEntryHash(prevHash, canonicalJson);
        await dbRun(
            database,
            `UPDATE system_audit_log
             SET prev_hash = ?, entry_hash = ?
             WHERE id = ?`,
            [prevHash, entryHash, row.id]
        );
        prevHash = entryHash;
    }
}

/**
 * The hash a row written before 3.0.0-rc.36 carries when its writer passed a
 * NUMERIC resourceId: that number was hashed as a number, while the TEXT column
 * stored it as text. Accepted alongside the canonical hash so those rows verify;
 * any change to the row's content still fails both. Null when the stored id is
 * not an integer.
 */
function legacyNumericIdHash(prevHash, row) {
    const id = row.resource_id;
    if (typeof id !== 'string' || !/^-?\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
    return computeEntryHash(prevHash, canonicalJsonOf({ ...normalizeCanonicalInput(row), resourceId: Number(id) }));
}

export async function verifyAuditChain({ tenant_id, database } = {}) {
    const db = database || await defaultDb();
    const rows = await dbAll(
        db,
        `SELECT *
         FROM system_audit_log
         WHERE tenant_id = ?
         ORDER BY id`,
        [tenant_id ?? 1]
    );
    let prevHash = null;
    let lastVerifiedId = null;
    for (const row of rows) {
        const expectedPrev = prevHash;
        if ((row.prev_hash ?? null) !== expectedPrev) {
            return {
                ok: false,
                brokenAt: row.id,
                expected: expectedPrev,
                actual: row.prev_hash ?? null,
            };
        }
        const expected = computeEntryHash(prevHash, canonicalRow(row));
        if (row.entry_hash !== expected && row.entry_hash !== legacyNumericIdHash(prevHash, row)) {
            return {
                ok: false,
                brokenAt: row.id,
                expected,
                actual: row.entry_hash,
            };
        }
        prevHash = row.entry_hash;
        lastVerifiedId = row.id;
    }
    return { ok: true, lastVerifiedId };
}

// In-process append mutex.
//
// One append at a time in this process. Each append reads the chain head
// and then writes the row hashed from it; two interleaved appends would read
// the same head, and the second would have to read it again. Serialising them
// here means that only happens across processes.
//
// A tiny FIFO promise-chain so only one append runs at a time.
// Inserts are cheap (microseconds) so the queue never grows.
let appendChain = Promise.resolve();
function withAppendLock(fn) {
    const next = appendChain.then(() => fn(), () => fn());
    // Don't propagate the previous tick's failure to the next caller.
    appendChain = next.catch(() => {});
    return next;
}

export async function appendAuditEntry(row, options = {}) {
    return withAppendLock(() => _appendAuditEntryUnlocked(row, options));
}

// How many times an append re-reads the head after another writer got in
// first. In one process the append lock above means this never loops; it is
// for a second process (scripts/retention-sweep.js) appending at the same
// moment.
const APPEND_ATTEMPTS = 10;

async function _appendAuditEntryUnlocked(row, { database } = {}) {
    const db = database || await defaultDb();
    await ensureAuditChainColumns(db);
    const tenantId = row.tenantId ?? row.tenant_id ?? 1;
    const timestamp = row.ts ?? row.timestamp ?? new Date().toISOString();
    const auditRow = { ...row, tenantId, tenant_id: tenantId, timestamp, ts: timestamp };
    const values = [
        timestamp,
        row.userId ?? row.user_id ?? null,
        row.username ?? null,
        row.action,
        row.resourceType ?? row.resource_type ?? null,
        asStoredText(row.resourceId ?? row.resource_id),
        asStoredText(row.resourceName ?? row.resource_name),
        serializeJsonish(row.oldValue ?? row.old_value ?? null),
        serializeJsonish(row.newValue ?? row.new_value ?? null),
        row.ipAddress ?? row.ip_address ?? null,
        row.userAgent ?? row.user_agent ?? null,
        row.sessionId ?? row.session_id ?? null,
        row.status ?? 'success',
        row.errorMessage ?? row.error_message ?? null,
        serializeJsonish(row.metadata ?? null),
        tenantId,
    ];
    // One statement, no transaction. This used to be BEGIN IMMEDIATE / read
    // the head / INSERT / COMMIT with an await between each step, so the
    // database write lock was held across event-loop turns. Under load every
    // other writer then waited on it, and the main connection's busy waits
    // froze the event loop for seconds at a time (stability run, rc.47: 40 s
    // stalls, SQLITE_BUSY 500s, lost writes). Now the head is read without a
    // lock and the INSERT carries its own check — it lands only if the head
    // is still the one the hash was computed from — so the lock is held for
    // one statement, and a writer that got in first makes this read again
    // instead of forking the chain.
    for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
        const previous = await dbGet(db, HEAD_SQL, [tenantId]);
        const prevHash = previous?.entry_hash ?? null;
        const entryHash = computeEntryHash(prevHash, canonicalRow(auditRow));
        const result = await dbRun(db, APPEND_IF_HEAD_SQL, [...values, prevHash, entryHash, tenantId, prevHash]);
        if (result.changes === 1) return { id: result.lastID, prevHash, entryHash };
    }
    throw new Error(`audit append for tenant ${tenantId} lost the race ${APPEND_ATTEMPTS} times`);
}

const HEAD_SQL = `SELECT entry_hash
     FROM system_audit_log
     WHERE tenant_id = ? AND entry_hash IS NOT NULL
     ORDER BY id DESC
     LIMIT 1`;

const APPEND_IF_HEAD_SQL = `INSERT INTO system_audit_log
     (timestamp, user_id, username, action, resource_type, resource_id, resource_name,
      old_value, new_value, ip_address, user_agent, session_id, status, error_message,
      metadata, tenant_id, prev_hash, entry_hash)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT entry_hash FROM system_audit_log
            WHERE tenant_id = ? AND entry_hash IS NOT NULL
            ORDER BY id DESC LIMIT 1) IS ?`;
