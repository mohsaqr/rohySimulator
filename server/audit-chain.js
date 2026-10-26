import crypto from 'node:crypto';
import net from 'node:net';

// Hash scheme 1: the fields every row written before 3.0.0-rc.89 was hashed
// over. It leaves out username, status, error_message and session_id, so those
// four could be rewritten without the chain noticing (security audit
// 2026-10-26, L6-07).
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

// Hash scheme 2 (migration 0073 adds `system_audit_log.hash_version`): scheme 1
// plus the four columns it missed. A row records which scheme hashed it, so the
// rows already in a chain keep verifying under scheme 1 while every new row is
// covered in full. A row whose version is changed back to NULL fails: its
// stored hash is a scheme-2 hash and the scheme-1 recomputation cannot match.
export const AUDIT_HASH_VERSION = 2;
const LOGICAL_FIELDS_V2 = [
    ...LOGICAL_FIELDS,
    'errorMessage',
    'sessionId',
    'status',
    'username',
];

// The longest the in-process append queue may grow. Appends are one INSERT
// each, so a healthy server never has more than a handful waiting; a queue this
// deep means something is flooding the audit log (security audit 2026-10-26,
// L8-01: forged learning-event batches queued one append per event). Past the
// bound an append is refused with AuditQueueFullError rather than letting the
// queue — and the write-lock time behind it — grow without limit.
export const AUDIT_MAX_PENDING = 1000;

/** Raised when the append queue is full. Callers log it; nothing retries it. */
export class AuditQueueFullError extends Error {
    constructor(pending) {
        super(`audit append queue full (${pending} pending)`);
        this.name = 'AuditQueueFullError';
        this.code = 'audit_queue_full';
        this.pending = pending;
    }
}

// ---------------------------------------------------------------------------
// Personal data in NEW audit rows (security audit 2026-10-26, F-32 / L7-05)
//
// The chain cannot be edited after the fact, so whatever personal data a row
// carries stays for as long as the chain does. From this release on:
//   - an e-mail address anywhere in old_value / new_value / metadata (a key
//     named email, e_mail, email_address, alternative_email or user_email) is
//     stored as a keyed digest, `hmac:<32 hex>`, never in clear. The key is
//     AUDIT_HASH_KEY, else JWT_SECRET, so the digest is stable across restarts
//     and an operator who knows an address can still find its rows
//     (auditEmailDigest), while the log alone does not reveal it;
//   - ip_address is truncated to its network: IPv4 to /24 (a.b.c.0), IPv6 to
//     /48. Enough to tell one site from another, not one machine from another.
// Usernames are kept: they are how an operator reads the log, and a purged
// account's username is replaced by its pseudonym in the row the purge writes.
// Rows already in the chain are never rewritten (that would break it).
// ---------------------------------------------------------------------------
const EMAIL_KEY_RE = /^(e-?mail|email_address|alternative_email|user_email)$/i;

function auditHashKey() {
    return process.env.AUDIT_HASH_KEY || process.env.JWT_SECRET || 'rohy-audit-digest';
}

/**
 * The digest an audit row stores in place of an e-mail address. Normalised
 * (trimmed, lower-cased) so "A@x.org " and "a@x.org" find the same rows.
 * @param {string} email
 * @returns {string} `hmac:<32 hex>`
 */
export function auditEmailDigest(email) {
    return auditDigest(String(email).trim().toLowerCase());
}

/**
 * The keyed digest the audit log stores for an identifier it must not hold in
 * clear (an e-mail; a purged account's former username). `hmac:<32 hex>`.
 * @param {string} value
 * @returns {string}
 */
export function auditDigest(value) {
    const hex = crypto.createHmac('sha256', auditHashKey()).update(String(value)).digest('hex');
    return `hmac:${hex.slice(0, 32)}`;
}

function digestEmails(value, depth = 0) {
    if (depth > 8 || value == null || typeof value !== 'object') return { value, changed: false };
    let changed = false;
    if (Array.isArray(value)) {
        const out = value.map((item) => {
            const r = digestEmails(item, depth + 1);
            changed = changed || r.changed;
            return r.value;
        });
        return { value: out, changed };
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        if (EMAIL_KEY_RE.test(key) && typeof child === 'string' && child !== '' && !child.startsWith('hmac:')) {
            out[key] = auditEmailDigest(child);
            changed = true;
            continue;
        }
        const r = digestEmails(child, depth + 1);
        changed = changed || r.changed;
        out[key] = r.value;
    }
    return { value: out, changed };
}

/** A payload with every e-mail replaced by its digest; untouched when it had none. */
function scrubPayload(raw) {
    if (raw == null) return raw;
    const parsed = parseJsonish(raw);
    if (parsed == null || typeof parsed !== 'object') return raw;
    const { value, changed } = digestEmails(parsed);
    if (!changed) return raw;
    return typeof raw === 'string' ? stableStringify(value) : value;
}

/**
 * An IP address cut to its network: IPv4 /24, IPv6 /48 (an IPv4-mapped IPv6
 * address is treated as the IPv4 it carries). Anything that is not an IP is
 * kept, capped at 64 characters.
 * @param {string|null|undefined} ip
 * @returns {string|null}
 */
export function truncateIp(ip) {
    if (ip == null || ip === '') return null;
    const text = String(ip).trim();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
    const candidate = mapped ? mapped[1] : text;
    const family = net.isIP(candidate);
    if (family === 4) {
        const parts = candidate.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
    if (family === 6) {
        // Expand "::" so the first three groups are the first 48 bits.
        const [head, tail = ''] = candidate.split('::');
        const headGroups = head ? head.split(':') : [];
        const tailGroups = candidate.includes('::') ? (tail ? tail.split(':') : []) : [];
        const groups = candidate.includes('::')
            ? [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), ...tailGroups]
            : headGroups;
        const network = groups.slice(0, 3).map((g) => (g.includes('.') ? '0' : (g || '0').toLowerCase().replace(/^0+(?=.)/, '')));
        return `${network.join(':')}::`;
    }
    return text.slice(0, 64);
}

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
        // Scheme 2 only. session_id is an INTEGER column: "12" is stored and
        // read back as 12, so it is hashed in that stored form.
        username: row.username ?? null,
        status: row.status ?? 'success',
        errorMessage: row.errorMessage ?? row.error_message ?? null,
        sessionId: asStoredInteger(row.sessionId ?? row.session_id),
    };
}

function asStoredInteger(value) {
    if (value == null || value === '') return value === '' ? '' : null;
    if (typeof value === 'number') return value;
    const text = String(value);
    return /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : text;
}

/** The hash scheme a row (stored or about to be) is hashed under. */
function hashVersionOf(row) {
    const v = Number(row.hashVersion ?? row.hash_version);
    return v === 2 ? 2 : 1;
}

/**
 * Canonical JSON of an audit row under its hash scheme: `version` when given,
 * else the row's own `hash_version` (NULL / absent = scheme 1).
 */
export function canonicalRow(row, version = hashVersionOf(row)) {
    return canonicalJsonOf(normalizeCanonicalInput(row), version);
}

function canonicalJsonOf(normalized, version = 1) {
    const sorted = {};
    for (const key of (version === 2 ? LOGICAL_FIELDS_V2 : LOGICAL_FIELDS)) {
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
// The cached value records whether the table has migration 0073's
// `hash_version` column, which decides the scheme new rows are hashed under.
const schemaEnsured = new WeakMap();

export async function ensureAuditChainColumns(database) {
    if (schemaEnsured.has(database)) return schemaEnsured.get(database);
    const columns = await dbAll(database, 'PRAGMA table_info(system_audit_log)');
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('prev_hash')) {
        await dbRun(database, 'ALTER TABLE system_audit_log ADD COLUMN prev_hash TEXT');
    }
    if (!names.has('entry_hash')) {
        await dbRun(database, 'ALTER TABLE system_audit_log ADD COLUMN entry_hash TEXT');
    }
    // hash_version is NOT added here: migration 0073 owns it, and adding it
    // here first would make that migration's ALTER fail.
    const state = { hashVersion: names.has('hash_version') };
    schemaEnsured.set(database, state);
    return state;
}

/**
 * Forget what ensureAuditChainColumns learnt about `database`. The migration
 * runner calls it after applying migrations, so a column a migration added in
 * this process (0073's hash_version) is seen by the next append.
 */
export function forgetAuditChainSchema(database) {
    schemaEnsured.delete(database);
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
        const version = hashVersionOf(row);
        const expected = computeEntryHash(prevHash, canonicalRow(row, version));
        // The numeric-id fallback is a scheme-1 artefact (pre rc.36); a
        // scheme-2 row must match its own hash exactly.
        if (row.entry_hash !== expected && (version !== 1 || row.entry_hash !== legacyNumericIdHash(prevHash, row))) {
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
// A tiny FIFO promise-chain so only one append runs at a time. Inserts are
// cheap, so in normal use the queue stays a few entries deep; it is bounded
// (AUDIT_MAX_PENDING) because one flooding caller used to be able to grow it
// without limit and hold every other audited write behind it.
let appendChain = Promise.resolve();
let pendingAppends = 0;
function withAppendLock(fn) {
    if (pendingAppends >= AUDIT_MAX_PENDING) {
        return Promise.reject(new AuditQueueFullError(pendingAppends));
    }
    pendingAppends += 1;
    const next = appendChain.then(() => fn(), () => fn());
    const settled = () => { pendingAppends -= 1; };
    next.then(settled, settled);
    // Don't propagate the previous tick's failure to the next caller.
    appendChain = next.catch(() => {});
    return next;
}

/** How many appends are queued or running in this process (for health and tests). */
export function pendingAuditAppends() {
    return pendingAppends;
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
    const schema = await ensureAuditChainColumns(db);
    const hashVersion = schema?.hashVersion ? AUDIT_HASH_VERSION : null;
    const tenantId = row.tenantId ?? row.tenant_id ?? 1;
    const timestamp = row.ts ?? row.timestamp ?? new Date().toISOString();
    // What is stored is what is hashed: the e-mail digests and the truncated
    // IP replace the raw values in both (see "Personal data" above).
    const oldValue = scrubPayload(row.oldValue ?? row.old_value ?? null);
    const newValue = scrubPayload(row.newValue ?? row.new_value ?? null);
    const metadata = scrubPayload(row.metadata ?? null);
    const ipAddress = truncateIp(row.ipAddress ?? row.ip_address ?? null);
    const auditRow = {
        ...row,
        tenantId, tenant_id: tenantId, timestamp, ts: timestamp,
        oldValue, old_value: oldValue, newValue, new_value: newValue, metadata,
        ipAddress, ip_address: ipAddress,
        status: row.status ?? 'success',
        hashVersion: hashVersion ?? 1, hash_version: hashVersion,
    };
    const values = [
        timestamp,
        row.userId ?? row.user_id ?? null,
        row.username ?? null,
        row.action,
        row.resourceType ?? row.resource_type ?? null,
        asStoredText(row.resourceId ?? row.resource_id),
        asStoredText(row.resourceName ?? row.resource_name),
        serializeJsonish(oldValue),
        serializeJsonish(newValue),
        ipAddress,
        row.userAgent ?? row.user_agent ?? null,
        row.sessionId ?? row.session_id ?? null,
        row.status ?? 'success',
        row.errorMessage ?? row.error_message ?? null,
        serializeJsonish(metadata),
        tenantId,
    ];
    const appendSql = hashVersion ? APPEND_IF_HEAD_SQL_V2 : APPEND_IF_HEAD_SQL;
    const versionParam = hashVersion ? [hashVersion] : [];
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
        const result = await dbRun(db, appendSql, [...values, prevHash, entryHash, ...versionParam, tenantId, prevHash]);
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

const APPEND_IF_HEAD_SQL_V2 = `INSERT INTO system_audit_log
     (timestamp, user_id, username, action, resource_type, resource_id, resource_name,
      old_value, new_value, ip_address, user_agent, session_id, status, error_message,
      metadata, tenant_id, prev_hash, entry_hash, hash_version)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT entry_hash FROM system_audit_log
            WHERE tenant_id = ? AND entry_hash IS NOT NULL
            ORDER BY id DESC LIMIT 1) IS ?`;
