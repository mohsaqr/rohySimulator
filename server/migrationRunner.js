import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { backfillAuditChain, ensureAuditChainColumns, forgetAuditChainSchema } from './audit-chain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultMigrationsDir = path.join(repoRoot, 'migrations');
const migrationLog = logger('migration');

const BASELINE_VERSIONS = new Set(['0001']);
const BASELINE_TABLES = [
    'users',
    'cases',
    'sessions',
    'interactions',
    'alarm_config',
    'agent_templates',
    'treatment_orders',
    'questionnaire_responses'
];

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            err ? reject(err) : resolve(this);
        });
    });
}

function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => err ? reject(err) : resolve());
    });
}

function checksum(sql) {
    return crypto.createHash('sha256').update(sql).digest('hex');
}

export function discoverMigrations(migrationsDir = defaultMigrationsDir) {
    return fs.readdirSync(migrationsDir)
        .filter((file) => /^\d+_.+\.sql$/.test(file))
        .sort((a, b) => a.localeCompare(b))
        .map((file) => {
            const version = file.split('_', 1)[0];
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            return {
                version,
                name: file,
                path: path.join(migrationsDir, file),
                sql,
                checksum: checksum(sql)
            };
        });
}

async function schemaMigrationsExists(db) {
    const row = await get(
        db,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    );
    return Boolean(row);
}

async function ensureSchemaMigrations(db) {
    await exec(db, `
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            checksum TEXT NOT NULL
        );
    `);
}

async function getAppliedMigrations(db) {
    if (!await schemaMigrationsExists(db)) return new Map();
    const rows = await all(db, 'SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    return new Map(rows.map((row) => [row.version, row]));
}

async function hasBaselineSchema(db) {
    // SQLite-specific pre-baselined detection: this checks sqlite_master for
    // existing tables before stamping the extracted baseline migration. A
    // future Postgres migration runner should use information_schema.tables for
    // the equivalent check; do not treat this PRAGMA/sqlite_master framework as
    // portable database infrastructure.
    const placeholders = BASELINE_TABLES.map(() => '?').join(',');
    const rows = await all(
        db,
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
        BASELINE_TABLES
    );
    return rows.length === BASELINE_TABLES.length;
}

async function stampBaseline(db, migrations) {
    const baselineMigrations = migrations.filter((migration) => BASELINE_VERSIONS.has(migration.version));
    if (baselineMigrations.length === 0) return [];

    await run(db, 'BEGIN');
    try {
        for (const migration of baselineMigrations) {
            await run(
                db,
                `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at, checksum)
                 VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
                [migration.version, migration.name, migration.checksum]
            );
        }
        await run(db, 'COMMIT');
        return baselineMigrations;
    } catch (err) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw err;
    }
}

function hasExplicitTransaction(sql) {
    return /\bBEGIN\b/i.test(sql) || /\bCOMMIT\b/i.test(sql);
}

async function recordMigration(db, migration) {
    await run(
        db,
        `INSERT INTO schema_migrations (version, name, applied_at, checksum)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
        [migration.version, migration.name, migration.checksum]
    );
}

async function applyMigration(db, migration) {
    if (migration.version === '0008') {
        await run(db, 'BEGIN');
        try {
            await ensureAuditChainColumns(db);
            await exec(db, migration.sql);
            await backfillAuditChain(db);
            await recordMigration(db, migration);
            await run(db, 'COMMIT');
        } catch (err) {
            await run(db, 'ROLLBACK').catch(() => {});
            throw err;
        }
        return;
    }

    if (hasExplicitTransaction(migration.sql)) {
        await exec(db, migration.sql);
        await run(db, 'BEGIN');
        try {
            await recordMigration(db, migration);
            await run(db, 'COMMIT');
        } catch (err) {
            await run(db, 'ROLLBACK').catch(() => {});
            throw err;
        }
        return;
    }

    await run(db, 'BEGIN');
    try {
        await exec(db, migration.sql);
        await recordMigration(db, migration);
        await run(db, 'COMMIT');
    } catch (err) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw err;
    }
}

function printDryRun(migrations, applied, baselineWouldStamp) {
    const baselineVersions = new Set(baselineWouldStamp.map((migration) => migration.version));
    if (baselineWouldStamp.length > 0) {
        migrationLog.info('baseline stamp would apply', {
            migrations: baselineWouldStamp.map((migration) => ({
                name: migration.name,
                checksum: migration.checksum
            }))
        });
        baselineWouldStamp.forEach((migration) => {
            migrationLog.debug('baseline dry-run migration', {
                name: migration.name,
                checksum: migration.checksum
            });
        });
    }

    const pending = migrations.filter((migration) => (
        !applied.has(migration.version) && !baselineVersions.has(migration.version)
    ));
    if (pending.length === 0) {
        migrationLog.info('no pending migrations');
        return;
    }

    pending.forEach((migration) => {
        migrationLog.info('pending migration', {
            name: migration.name,
            checksum: migration.checksum,
            sql: migration.sql.trim()
        });
    });
}

export async function runMigrations(db, options = {}) {
    const migrationsDir = options.migrationsDir || defaultMigrationsDir;
    const dryRun = Boolean(options.dryRun);
    const migrations = discoverMigrations(migrationsDir);
    const applied = await getAppliedMigrations(db);

    for (const migration of migrations) {
        const row = applied.get(migration.version);
        if (row && row.checksum !== migration.checksum) {
            throw new Error(`Migration checksum mismatch for ${migration.name}`);
        }
    }

    const baselineWouldStamp = applied.size === 0 && await hasBaselineSchema(db)
        ? migrations.filter((migration) => BASELINE_VERSIONS.has(migration.version))
        : [];

    if (dryRun) {
        printDryRun(migrations, applied, baselineWouldStamp);
        return {
            applied: [],
            skipped: migrations.filter((migration) => applied.has(migration.version)),
            baselineStamped: baselineWouldStamp,
            dryRun: true
        };
    }

    await ensureSchemaMigrations(db);

    let effectiveApplied = await getAppliedMigrations(db);
    let baselineStamped = [];
    if (effectiveApplied.size === 0 && await hasBaselineSchema(db)) {
        baselineStamped = await stampBaseline(db, migrations);
        effectiveApplied = await getAppliedMigrations(db);
        if (baselineStamped.length > 0) {
            migrationLog.info('baseline stamped', {
                migrations: baselineStamped.map((m) => m.name)
            });
        }
    }

    const appliedNow = [];
    for (const migration of migrations) {
        if (effectiveApplied.has(migration.version)) continue;
        migrationLog.info('applying migration', {
            name: migration.name,
            version: migration.version,
            checksum: migration.checksum
        });
        await applyMigration(db, migration);
        appliedNow.push(migration);
        effectiveApplied.set(migration.version, migration);
    }

    if (appliedNow.length === 0) {
        migrationLog.info('database schema is current');
    } else {
        // A migration may have changed system_audit_log (0073 adds
        // hash_version); the audit chain re-reads its shape on the next append.
        forgetAuditChainSchema(db);
    }

    return {
        applied: appliedNow,
        skipped: migrations.filter((migration) => !appliedNow.includes(migration)),
        baselineStamped,
        dryRun: false
    };
}

// ---------------------------------------------------------------------------
// Pre-migration backup — shared by the boot path (server/db.js
// runDbMigrations) and the standalone CLI (scripts/migrate.js), which until
// rc.89 called runMigrations directly and took no backup at all (security
// audit 2026-10-26, L7-19).
// ---------------------------------------------------------------------------

// How many pre-migration snapshots to keep beside the database. Every release
// that ships a migration adds one full copy of the database; left alone they
// accumulate until the disk is full (which then breaks the next backup, and
// the next migration with it). Five covers rolling back across several
// releases; the operator's real backups are scripts/rohy-backup.sh.
export const MIGRATION_BACKUPS_KEEP = 5;

/**
 * Remove all but the newest `keep` `<db>.bak.*` snapshots beside `databasePath`.
 *
 * Newest by modification time, with the name as the tie-break so the order is
 * deterministic. Returns the paths removed; a listing or unlink failure is
 * reported, not thrown — pruning is housekeeping, never a reason to fail a boot.
 *
 * @param {string} databasePath
 * @param {object} [opts]
 * @param {number} [opts.keep=MIGRATION_BACKUPS_KEEP]
 * @param {object} [opts.log]
 * @returns {Promise<string[]>} the files that were removed
 */
export async function pruneMigrationBackups(databasePath, { keep = MIGRATION_BACKUPS_KEEP, log = migrationLog } = {}) {
    const dir = path.dirname(databasePath);
    const prefix = `${path.basename(databasePath)}.bak.`;
    let names;
    try {
        names = (await fs.promises.readdir(dir)).filter((name) => name.startsWith(prefix));
    } catch (err) {
        log.warn('pre-migration backup prune skipped', { dir, error: err.message });
        return [];
    }
    const stats = (await Promise.all(names.map(async (name) => {
        const file = path.join(dir, name);
        try {
            const stat = await fs.promises.stat(file);
            return stat.isFile() ? { file, mtimeMs: stat.mtimeMs, name } : null;
        } catch (err) {
            log.warn('pre-migration backup not inspected', { backup_path: file, error: err.message });
            return null;
        }
    }))).filter(Boolean);
    stats.sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
    const stale = stats.slice(keep);
    const removed = [];
    for (const { file } of stale) {
        try {
            await fs.promises.unlink(file);
            removed.push(file);
        } catch (err) {
            log.warn('pre-migration backup not removed', { backup_path: file, error: err.message });
        }
    }
    if (removed.length) log.info('pre-migration backups pruned', { kept: keep, removed });
    return removed;
}

/**
 * Snapshot the database file before any pending migration runs.
 *
 * Copies `databasePath` to `<databasePath>.bak.<ts>.<target version>` when at
 * least one migration on disk is not recorded in `schema_migrations` (a missing
 * table means first boot: everything is pending). Skipped for `:memory:` and
 * when ROHY_BACKUP_BEFORE_MIGRATE=0 (throwaway CI/test databases). The copy is
 * created owner-only (0600) whatever the umask. A failure is logged and
 * reported, never thrown: refusing to migrate because a backup failed would
 * brick upgrades on read-only or full disks, and the checksum guard still
 * catches a corrupted run.
 *
 * @param {import('sqlite3').Database} db       open handle on databasePath
 * @param {string} databasePath
 * @param {{migrationsDir?: string, log?: object}} [opts]
 * @returns {Promise<{tookBackup: boolean, backupPath: string|null, pending: number}>}
 */
export async function backupBeforeMigrate(db, databasePath, { migrationsDir = defaultMigrationsDir, log = migrationLog } = {}) {
    const none = { tookBackup: false, backupPath: null, pending: 0 };
    if (process.env.ROHY_BACKUP_BEFORE_MIGRATE === '0' || !databasePath || databasePath === ':memory:') return none;
    try {
        const migrations = discoverMigrations(migrationsDir);
        const applied = await new Promise((resolve) => {
            db.all('SELECT version FROM schema_migrations', [], (err, rows) => {
                if (err) return resolve(new Set());  // table not yet created → first boot
                resolve(new Set((rows || []).map((r) => r.version)));
            });
        });
        const willApply = migrations.filter((m) => !applied.has(m.version));
        if (willApply.length === 0 || !fs.existsSync(databasePath)) return { ...none, pending: willApply.length };
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const targetVersion = willApply[willApply.length - 1].version;
        const backupPath = `${databasePath}.bak.${ts}.${targetVersion}`;
        await fs.promises.copyFile(databasePath, backupPath);
        await fs.promises.chmod(backupPath, 0o600);
        log.info('pre-migration backup created', {
            backup_path: backupPath,
            pending_migrations: willApply.length,
            target_version: targetVersion,
        });
        return { tookBackup: true, backupPath, pending: willApply.length };
    } catch (err) {
        log.warn('pre-migration backup failed', { error: err.message });
        return none;
    }
}
