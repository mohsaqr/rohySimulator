#!/usr/bin/env node
// Map LOINC codes + UCUM units onto the existing lab_tests rows.
//
// Why this is augment-only:
//   The simulator already curates 196 lab_tests with chosen ranges + units.
//   Bulk-importing all 2,400+ LOINC test rows would dilute the curation
//   (per the locked plan). Instead, we keep the row set fixed and stamp
//   loinc_code + ucum_unit onto rows we already have, sourced from
//   server/data/lab_loinc_mapping.json (hand-curated, ~120 patterns).
//
// Match strategy: case-insensitive substring on test_name. When multiple
// patterns match, the longer pattern wins (so "Mean Corpuscular Hemoglobin
// Concentration" matches MCHC code rather than the "Hemoglobin" code).
//
// Idempotent: rows already stamped get rewritten only if the pattern's
// LOINC differs (we always update on match — refresh-safe).
//
// Usage:
//   node scripts/import-loinc-mapping.js
//   ROHY_DB=/tmp/foo.sqlite node scripts/import-loinc-mapping.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_KEY = 'loinc_v2.82';
const MAPPING_PATH = path.join(repoRoot, 'server', 'data', 'lab_loinc_mapping.json');

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
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

// Pick the longest pattern whose lowercase form is a substring of test_name.
// Longer pattern winning matters for "Mean Corpuscular Hemoglobin Concentration"
// vs "Hemoglobin" — we want the more specific match.
function pickBest(testName, patterns) {
    const lower = testName.toLowerCase();
    let best = null;
    for (const m of patterns) {
        if (lower.includes(m.pattern.toLowerCase())) {
            if (!best || m.pattern.length > best.pattern.length) best = m;
        }
    }
    return best;
}

export async function importLoincMapping(db, { mappingPath = MAPPING_PATH, log = console.log } = {}) {
    const raw = fs.readFileSync(mappingPath, 'utf8');
    const data = JSON.parse(raw);
    const patterns = data.mappings || [];
    if (!patterns.length) throw new Error('lab_loinc_mapping.json: empty mappings');

    const source = await get(db, 'SELECT id FROM data_sources WHERE source_key = ?', [SOURCE_KEY]);
    if (!source) throw new Error(`data_sources row '${SOURCE_KEY}' missing — run migrations first`);

    const labRows = await all(db, 'SELECT id, test_name FROM lab_tests');
    let mapped = 0;
    let unmapped = 0;
    const unmappedNames = [];

    for (const row of labRows) {
        const match = pickBest(row.test_name, patterns);
        if (match) {
            await run(db,
                `UPDATE lab_tests
                 SET loinc_code = ?, ucum_unit = ?, data_source_id = ?, is_curated = 1
                 WHERE id = ?`,
                [match.loinc_code, match.ucum_unit, source.id, row.id]
            );
            mapped += 1;
        } else {
            unmapped += 1;
            unmappedNames.push(row.test_name);
        }
    }

    await run(db,
        `UPDATE data_sources SET rows_imported = ?, imported_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [mapped, source.id]
    );

    log(`[import-loinc] mapped ${mapped}/${labRows.length} lab tests; ${unmapped} unmapped`);
    if (unmapped > 0 && unmapped <= 30) {
        log(`[import-loinc] unmapped tests: ${unmappedNames.join(', ')}`);
    }
    return { mapped, unmapped, unmappedNames, sourceId: source.id };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const dbPath = process.env.ROHY_DB || path.join(repoRoot, 'server', 'database.sqlite');
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(dbPath, async (err) => {
        if (err) {
            console.error(`[import-loinc] open ${dbPath}: ${err.message}`);
            process.exit(1);
        }
        try {
            await importLoincMapping(db);
            db.close();
        } catch (impErr) {
            console.error(`[import-loinc] failed: ${impErr.message}`);
            db.close(() => process.exit(1));
        }
    });
}
