#!/usr/bin/env node
// Seed / refresh `treatment_effects` from server/data/treatment_effects.json.
//
// Why JSON-driven:
//   The previous inline seeder (server/db.js seedDefaultTreatmentEffects)
//   hard-coded ~33 rows. Curated content now lives in JSON so it can be
//   diff-reviewed in PRs, refreshed without re-applying a migration, and
//   imported into a fresh DB by running this script directly.
//
// Idempotent: uses INSERT ... ON CONFLICT (treatment_name, route) DO UPDATE.
// That means re-running the script safely updates rows whose curated values
// changed (e.g. corrected PK numbers) and inserts any new rows. It will
// never duplicate. The unique constraint comes from migration 0001.
//
// Stamps data_source_id pointing at the 'curated' row in `data_sources`
// (seeded by migration 0007). The `rows_imported` count on data_sources
// is updated at the end so the provenance row reflects reality.
//
// Usage:
//   node scripts/seed-treatment-effects.js                # default DB
//   ROHY_DB=/tmp/test.sqlite node scripts/seed-treatment-effects.js

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_KEY = 'curated';
const DATA_PATH = path.join(repoRoot, 'server', 'data', 'treatment_effects.json');

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

export async function seedTreatmentEffects(db, { dataPath = DATA_PATH, log = console.log } = {}) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const payload = JSON.parse(raw);
    const rows = Array.isArray(payload.rows) ? payload.rows : payload;
    if (!Array.isArray(rows)) {
        throw new Error(`treatment_effects.json: expected {rows: [...]} or [...]`);
    }
    const checksum = crypto.createHash('sha256').update(raw).digest('hex');

    const source = await get(db, 'SELECT id FROM data_sources WHERE source_key = ?', [SOURCE_KEY]);
    if (!source) {
        throw new Error(`data_sources row '${SOURCE_KEY}' missing — run migrations first`);
    }

    // Use INSERT ... ON CONFLICT so re-running updates curated values without
    // creating duplicate rows. Keeps medication_id NULL on insert (the
    // medications-catalogue seeder backfills it via name match in a follow-up).
    const sql = `
        INSERT INTO treatment_effects (
            treatment_type, treatment_name, route,
            onset_minutes, peak_minutes, duration_minutes,
            hr_effect, bp_sys_effect, bp_dia_effect, rr_effect, spo2_effect, temp_effect, etco2_effect,
            dose_dependent, base_dose, base_dose_unit, max_effect_multiplier,
            description, is_active, rxcui, data_source_id, pk_source, pk_evidence_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(treatment_name, route) DO UPDATE SET
            treatment_type        = excluded.treatment_type,
            onset_minutes         = excluded.onset_minutes,
            peak_minutes          = excluded.peak_minutes,
            duration_minutes      = excluded.duration_minutes,
            hr_effect             = excluded.hr_effect,
            bp_sys_effect         = excluded.bp_sys_effect,
            bp_dia_effect         = excluded.bp_dia_effect,
            rr_effect             = excluded.rr_effect,
            spo2_effect           = excluded.spo2_effect,
            temp_effect           = excluded.temp_effect,
            etco2_effect          = excluded.etco2_effect,
            dose_dependent        = excluded.dose_dependent,
            base_dose             = excluded.base_dose,
            base_dose_unit        = excluded.base_dose_unit,
            max_effect_multiplier = excluded.max_effect_multiplier,
            description           = excluded.description,
            is_active             = 1,
            rxcui                 = excluded.rxcui,
            data_source_id        = excluded.data_source_id,
            pk_source             = excluded.pk_source,
            pk_evidence_url       = excluded.pk_evidence_url
    `;

    let inserted = 0;
    for (const row of rows) {
        await run(db, sql, [
            row.treatment_type,
            row.treatment_name,
            row.route ?? null,
            row.onset_minutes ?? 5,
            row.peak_minutes ?? 15,
            row.duration_minutes ?? 60,
            row.hr_effect ?? 0,
            row.bp_sys_effect ?? 0,
            row.bp_dia_effect ?? 0,
            row.rr_effect ?? 0,
            row.spo2_effect ?? 0,
            row.temp_effect ?? 0,
            row.etco2_effect ?? 0,
            row.dose_dependent ? 1 : 0,
            row.base_dose ?? null,
            row.base_dose_unit ?? null,
            row.max_effect_multiplier ?? 2.0,
            row.description ?? null,
            row.rxcui ?? null,
            source.id,
            row.pk_source ?? null,
            row.pk_evidence_url ?? null,
        ]);
        inserted += 1;
    }

    await run(db, `UPDATE data_sources SET rows_imported = ?, checksum_sha256 = ?, imported_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [inserted, checksum, source.id]);

    log(`[seed-treatment-effects] upserted ${inserted} rows (data_source_id=${source.id}, checksum=${checksum.slice(0, 12)}…)`);
    return { inserted, checksum, sourceId: source.id };
}

// CLI mode
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const dbPath = process.env.ROHY_DB || path.join(repoRoot, 'server', 'database.sqlite');
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(dbPath, async (err) => {
        if (err) {
            console.error(`[seed-treatment-effects] open ${dbPath}: ${err.message}`);
            process.exit(1);
        }
        try {
            await seedTreatmentEffects(db);
            db.close();
        } catch (seedErr) {
            console.error(`[seed-treatment-effects] failed: ${seedErr.message}`);
            db.close(() => process.exit(1));
        }
    });
}
