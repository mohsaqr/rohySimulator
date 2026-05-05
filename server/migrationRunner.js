import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultMigrationsDir = path.join(repoRoot, 'migrations');

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
        console.log('[migration] baseline stamp would apply:');
        baselineWouldStamp.forEach((migration) => {
            console.log(`-- ${migration.name} (${migration.checksum})`);
        });
    }

    const pending = migrations.filter((migration) => (
        !applied.has(migration.version) && !baselineVersions.has(migration.version)
    ));
    if (pending.length === 0) {
        console.log('[migration] no pending migrations');
        return;
    }

    pending.forEach((migration) => {
        console.log(`\n-- ${migration.name} (${migration.checksum})`);
        console.log(migration.sql.trim());
        console.log('');
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
            console.log(`[migration] baseline-stamped ${baselineStamped.map((m) => m.name).join(', ')}`);
        }
    }

    const appliedNow = [];
    for (const migration of migrations) {
        if (effectiveApplied.has(migration.version)) continue;
        console.log(`[migration] applying ${migration.name}`);
        await applyMigration(db, migration);
        appliedNow.push(migration);
        effectiveApplied.set(migration.version, migration);
    }

    if (appliedNow.length === 0) {
        console.log('[migration] database schema is current');
    }

    return {
        applied: appliedNow,
        skipped: migrations.filter((migration) => !appliedNow.includes(migration)),
        baselineStamped,
        dryRun: false
    };
}
