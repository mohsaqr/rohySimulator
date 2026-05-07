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

async function defaultDb() {
    const mod = await import('./db.js');
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

function normalizeCanonicalInput(row) {
    return {
        userId: row.userId ?? row.user_id ?? null,
        action: row.action ?? null,
        resourceType: row.resourceType ?? row.resource_type ?? null,
        resourceId: row.resourceId ?? row.resource_id ?? null,
        resourceName: row.resourceName ?? row.resource_name ?? null,
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
    const normalized = normalizeCanonicalInput(row);
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

export async function ensureAuditChainColumns(database) {
    const columns = await dbAll(database, 'PRAGMA table_info(system_audit_log)');
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('prev_hash')) {
        await dbRun(database, 'ALTER TABLE system_audit_log ADD COLUMN prev_hash TEXT');
    }
    if (!names.has('entry_hash')) {
        await dbRun(database, 'ALTER TABLE system_audit_log ADD COLUMN entry_hash TEXT');
    }
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
        if (row.entry_hash !== expected) {
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

export async function appendAuditEntry(row, { database } = {}) {
    const db = database || await defaultDb();
    await ensureAuditChainColumns(db);
    await dbRun(db, 'BEGIN IMMEDIATE');
    try {
        const tenantId = row.tenantId ?? row.tenant_id ?? 1;
        const previous = await dbGet(
            db,
            `SELECT entry_hash
             FROM system_audit_log
             WHERE tenant_id = ? AND entry_hash IS NOT NULL
             ORDER BY id DESC
             LIMIT 1`,
            [tenantId]
        );
        const timestamp = row.ts ?? row.timestamp ?? new Date().toISOString();
        const auditRow = {
            ...row,
            tenantId,
            tenant_id: tenantId,
            timestamp,
            ts: timestamp,
        };
        const prevHash = previous?.entry_hash ?? null;
        const entryHash = computeEntryHash(prevHash, canonicalRow(auditRow));
        const result = await dbRun(
            db,
            `INSERT INTO system_audit_log
             (timestamp, user_id, username, action, resource_type, resource_id, resource_name,
              old_value, new_value, ip_address, user_agent, session_id, status, error_message,
              metadata, tenant_id, prev_hash, entry_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                timestamp,
                row.userId ?? row.user_id ?? null,
                row.username ?? null,
                row.action,
                row.resourceType ?? row.resource_type ?? null,
                row.resourceId ?? row.resource_id ?? null,
                row.resourceName ?? row.resource_name ?? null,
                serializeJsonish(row.oldValue ?? row.old_value ?? null),
                serializeJsonish(row.newValue ?? row.new_value ?? null),
                row.ipAddress ?? row.ip_address ?? null,
                row.userAgent ?? row.user_agent ?? null,
                row.sessionId ?? row.session_id ?? null,
                row.status ?? 'success',
                row.errorMessage ?? row.error_message ?? null,
                serializeJsonish(row.metadata ?? null),
                tenantId,
                prevHash,
                entryHash,
            ]
        );
        await dbRun(db, 'COMMIT');
        return { id: result.lastID, prevHash, entryHash };
    } catch (err) {
        await dbRun(db, 'ROLLBACK').catch(() => {});
        throw err;
    }
}
