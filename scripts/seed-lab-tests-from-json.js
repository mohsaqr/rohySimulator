#!/usr/bin/env node
// Mirror Lab_database.json (+ heart.txt) into the lab_tests SQL table.
//
// Why this exists:
//   The simulator historically reads lab tests from JSON via
//   server/services/labDatabase.js. The lab_tests SQL table was created in
//   migration 0001 but only populated by an admin-triggered route. With
//   the new tiered catalogue (curated | custom | searchable) we need the
//   curated rows to live in SQL so:
//     - LOINC codes can be stamped onto them (scripts/import-loinc-mapping.js)
//     - pediatric reference ranges can FK to them (scripts/seed-pediatric-ranges.js)
//     - student/educator additions live in the same table with scope='user'
//   This script is the bridge: every row in Lab_database.json + heart.txt
//   becomes a lab_tests row with is_curated=1, scope='platform',
//   data_source_id pointing at the 'curated' provenance row.
//
// Future direction: once the settings UI in Session 3 reads from this
// table directly, we can deprecate the JSON file and the labDatabase.js
// loader. Until then, both paths coexist.
//
// Idempotent: we synthesise a deterministic test_code from the row and
// upsert via INSERT ... ON CONFLICT(test_code) DO UPDATE.
//
// Usage:
//   node scripts/seed-lab-tests-from-json.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_KEY = 'curated';
const LAB_DB_PATH = path.join(repoRoot, 'Lab_database.json');
const HEART_PATH = path.join(repoRoot, 'heart.txt');

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
    });
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function slug(testName, group, category) {
    const base = `${testName}-${group}-${category || 'general'}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `cur-${base}`.slice(0, 96);
}

function loadAllTests() {
    const main = JSON.parse(fs.readFileSync(LAB_DB_PATH, 'utf8'));
    let extra = [];
    if (fs.existsSync(HEART_PATH)) {
        try { extra = JSON.parse(fs.readFileSync(HEART_PATH, 'utf8')); } catch { /* ignore */ }
    }
    // De-dup on (test_name, category) to mirror loadLabDatabase() in
    // server/services/labDatabase.js.
    const seen = new Set();
    const out = [];
    for (const row of [...main, ...extra]) {
        const key = `${row.test_name}|${row.category || 'General'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    return out;
}

export async function seedLabTestsFromJson(db, { log = console.log } = {}) {
    const tests = loadAllTests();
    const source = await get(db, 'SELECT id FROM data_sources WHERE source_key = ?', [SOURCE_KEY]);
    if (!source) throw new Error(`data_sources row '${SOURCE_KEY}' missing — run migrations first`);

    const upsert = `
        INSERT INTO lab_tests (
            test_code, test_name, test_group, category,
            min_value, max_value, unit, normal_samples,
            is_active, is_curated, scope, tenant_id, data_source_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'platform', 1, ?)
        ON CONFLICT(test_code) DO UPDATE SET
            test_name      = excluded.test_name,
            test_group     = excluded.test_group,
            category       = excluded.category,
            min_value      = excluded.min_value,
            max_value      = excluded.max_value,
            unit           = excluded.unit,
            normal_samples = excluded.normal_samples,
            is_curated     = 1,
            scope          = 'platform',
            tenant_id      = 1,
            data_source_id = excluded.data_source_id,
            updated_at     = CURRENT_TIMESTAMP
    `;

    let upserted = 0;
    for (const t of tests) {
        const code = slug(t.test_name, t.group, t.category);
        await run(db, upsert, [
            code,
            t.test_name,
            t.group,
            t.category || 'General',
            t.min_value ?? null,
            t.max_value ?? null,
            t.unit,
            JSON.stringify(t.normal_samples || []),
            source.id,
        ]);
        upserted += 1;
    }

    log(`[seed-lab-tests-from-json] upserted ${upserted} lab_tests rows from JSON catalogue`);
    return { upserted, sourceId: source.id };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const dbPath = process.env.ROHY_DB || path.join(repoRoot, 'server', 'database.sqlite');
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(dbPath, async (err) => {
        if (err) {
            console.error(`[seed-lab-tests-from-json] open ${dbPath}: ${err.message}`);
            process.exit(1);
        }
        try {
            await seedLabTestsFromJson(db);
            db.close();
        } catch (seedErr) {
            console.error(`[seed-lab-tests-from-json] failed: ${seedErr.message}`);
            db.close(() => process.exit(1));
        }
    });
}
