#!/usr/bin/env node
// Seed lab_reference_ranges with pediatric overlay for tests we already curate.
//
// Why isolated: CALIPER reference intervals are CC BY-NC-SA. Keeping them in
// a single file (server/data/lab_pediatric_ranges.json) and a single table
// (lab_reference_ranges) means a commercial deploy can DELETE FROM
// lab_reference_ranges WHERE data_source_id = (SELECT id FROM data_sources
// WHERE source_key = 'caliper_2026') and remain license-clean. The rest of
// the curated catalogue is not affected.
//
// Match strategy: case-insensitive substring on lab_tests.test_name. If
// multiple lab_tests rows match the same pattern (e.g. "Hemoglobin" matches
// the Male and Female variants in our 215-row dataset), we insert a range
// row for each — they will agree on values per pattern, and queries can
// dedupe on (lab_test_id, population, age_band) at read time.
//
// Idempotent: clears existing CALIPER-sourced ranges then re-inserts. This
// makes refreshes deterministic; non-CALIPER ranges (e.g. Tietz adult) are
// untouched by this script.
//
// Usage:
//   node scripts/seed-pediatric-ranges.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_KEY = 'caliper_2026';
const DATA_PATH = path.join(repoRoot, 'server', 'data', 'lab_pediatric_ranges.json');

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

export async function seedPediatricRanges(db, { dataPath = DATA_PATH, log = console.log } = {}) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw);
    const ranges = data.ranges || [];
    if (!ranges.length) throw new Error('lab_pediatric_ranges.json: empty ranges');

    const source = await get(db, 'SELECT id FROM data_sources WHERE source_key = ?', [SOURCE_KEY]);
    if (!source) throw new Error(`data_sources row '${SOURCE_KEY}' missing — run migrations first`);

    // Idempotency: drop existing CALIPER rows so re-running produces a clean state.
    await run(db, 'DELETE FROM lab_reference_ranges WHERE data_source_id = ?', [source.id]);

    let inserted = 0;
    let unmatched = 0;
    const unmatchedPatterns = [];
    const labRows = await all(db, 'SELECT id, test_name FROM lab_tests');

    for (const r of ranges) {
        const pattern = r.lab_test_name_pattern.toLowerCase();
        const matches = labRows.filter((row) => row.test_name.toLowerCase().includes(pattern));
        if (matches.length === 0) {
            unmatched += 1;
            unmatchedPatterns.push(r.lab_test_name_pattern);
            continue;
        }
        for (const lab of matches) {
            await run(db, `
                INSERT INTO lab_reference_ranges (
                    lab_test_id, population, sex, age_min_years, age_max_years,
                    range_low, range_high, critical_low, critical_high,
                    unit, source, source_citation, data_source_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                lab.id,
                r.population,
                r.sex ?? null,
                r.age_min_years ?? null,
                r.age_max_years ?? null,
                r.range_low ?? null,
                r.range_high ?? null,
                r.critical_low ?? null,
                r.critical_high ?? null,
                r.unit,
                'CALIPER',
                r.source_citation ?? null,
                source.id,
            ]);
            inserted += 1;
        }
    }

    await run(db,
        `UPDATE data_sources SET rows_imported = ?, imported_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [inserted, source.id]
    );

    log(`[seed-pediatric-ranges] inserted ${inserted} range rows; ${unmatched} patterns had no lab_tests match`);
    if (unmatched > 0) log(`[seed-pediatric-ranges] unmatched: ${unmatchedPatterns.join(', ')}`);
    return { inserted, unmatched, sourceId: source.id };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const dbPath = process.env.ROHY_DB || path.join(repoRoot, 'server', 'database.sqlite');
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(dbPath, async (err) => {
        if (err) {
            console.error(`[seed-pediatric-ranges] open ${dbPath}: ${err.message}`);
            process.exit(1);
        }
        try {
            await seedPediatricRanges(db);
            db.close();
        } catch (seedErr) {
            console.error(`[seed-pediatric-ranges] failed: ${seedErr.message}`);
            db.close(() => process.exit(1));
        }
    });
}
