#!/usr/bin/env node
// Seed / refresh `medications` catalogue from server/data/treatment_effects.json.
//
// Strategy: 1:1 mirror of medication-type rows in treatment_effects. The
// catalogue's job is to surface a name + class + canonical id (RxCUI) for
// the order picker; the simulation engine reads PK numbers from
// treatment_effects, not medications. Keeping them parallel avoids a
// foreign key the engine doesn't need at runtime.
//
// After upserting medications rows, this script back-fills
// `treatment_effects.medication_id` so existing analytics (e.g. drug-class
// rollups) can join. The link is by (generic_name, route) — matches the
// UNIQUE constraint on treatment_effects.
//
// Idempotent: ON CONFLICT(medication_code) DO UPDATE.
//   medication_code is synthesised from a deterministic slug of name+route
//   so re-runs hit the same row.
//
// Usage:
//   node scripts/seed-curated-medications.js

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

function slug(name, route) {
    const base = `${name}-${route || 'na'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `cur-${base}`.slice(0, 64);
}

// Map free-text route in treatment_effects to the medications.route CHECK list.
// CHECK list is: oral, iv, im, sc, topical, inhaled, sublingual, rectal, other.
function normaliseRoute(route) {
    if (!route) return 'other';
    const r = String(route).toLowerCase();
    if (r === 'iv' || r === 'i.v.' || r === 'intravenous') return 'iv';
    if (r === 'im' || r === 'i.m.' || r === 'intramuscular') return 'im';
    if (r === 'sc' || r === 'subq' || r === 'subcutaneous') return 'sc';
    if (r === 'oral' || r === 'po') return 'oral';
    if (r === 'inhaled' || r === 'neb' || r === 'nebulised' || r === 'nebulized') return 'inhaled';
    if (r === 'sl' || r === 'sublingual') return 'sublingual';
    if (r === 'pr' || r === 'rectal') return 'rectal';
    if (r === 'topical') return 'topical';
    return 'other';
}

// Drug-class hint from description text. Best-effort: the curated rows have
// short class-tagged descriptions ("Beta blocker - …", "Loop diuretic - …")
// so we extract the prefix before the first " - ".
function classFromDescription(description) {
    if (!description) return null;
    const idx = description.indexOf(' - ');
    if (idx > 0 && idx < 80) return description.slice(0, idx).trim();
    return null;
}

export async function seedCuratedMedications(db, { dataPath = DATA_PATH, log = console.log } = {}) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const payload = JSON.parse(raw);
    const rows = (Array.isArray(payload.rows) ? payload.rows : payload)
        .filter((r) => r.treatment_type === 'medication');

    const source = await get(db, 'SELECT id FROM data_sources WHERE source_key = ?', [SOURCE_KEY]);
    if (!source) throw new Error(`data_sources row '${SOURCE_KEY}' missing — run migrations first`);

    const upsert = `
        INSERT INTO medications (
            medication_code, generic_name, drug_class, category, route,
            typical_dose, dose_unit, onset_minutes, duration_minutes, half_life_hours,
            is_active, is_curated, scope, tenant_id, data_source_id, rxcui, external_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, 'platform', 1, ?, ?, ?)
        ON CONFLICT(medication_code) DO UPDATE SET
            generic_name      = excluded.generic_name,
            drug_class        = excluded.drug_class,
            route             = excluded.route,
            typical_dose      = excluded.typical_dose,
            dose_unit         = excluded.dose_unit,
            onset_minutes     = excluded.onset_minutes,
            duration_minutes  = excluded.duration_minutes,
            is_curated        = 1,
            scope             = 'platform',
            tenant_id         = 1,
            data_source_id    = excluded.data_source_id,
            rxcui             = COALESCE(excluded.rxcui, medications.rxcui),
            external_source   = excluded.external_source,
            updated_at        = CURRENT_TIMESTAMP
    `;

    let upserted = 0;
    for (const row of rows) {
        const code = slug(row.treatment_name, row.route);
        const route = normaliseRoute(row.route);
        const drugClass = classFromDescription(row.description);
        await run(db, upsert, [
            code,
            row.treatment_name,
            drugClass,
            'curated',
            route,
            row.base_dose != null ? String(row.base_dose) : null,
            row.base_dose_unit ?? null,
            row.onset_minutes ?? null,
            row.duration_minutes ?? null,
            source.id,
            row.rxcui ?? null,
            row.rxcui ? 'rxnorm' : null,
        ]);
        upserted += 1;
    }

    // Back-fill treatment_effects.medication_id by name+route match. This is
    // a no-op for rows already linked. Uses the medications row we just
    // upserted as the join target.
    await run(db, `
        UPDATE treatment_effects
        SET medication_id = (
            SELECT m.id FROM medications m
            WHERE m.generic_name = treatment_effects.treatment_name
              AND m.is_curated = 1
              AND (
                  (m.route = 'iv' AND treatment_effects.route IN ('IV', 'iv'))
                  OR (m.route = 'im' AND treatment_effects.route IN ('IM', 'im'))
                  OR (m.route = 'sc' AND treatment_effects.route IN ('SC', 'sc'))
                  OR (m.route = 'oral' AND treatment_effects.route IN ('oral', 'PO'))
                  OR (m.route = 'inhaled' AND treatment_effects.route = 'inhaled')
              )
            LIMIT 1
        )
        WHERE treatment_effects.treatment_type = 'medication'
          AND treatment_effects.medication_id IS NULL
    `);

    const checksum = crypto.createHash('sha256').update(raw + ':medications').digest('hex');
    log(`[seed-curated-medications] upserted ${upserted} medication rows (data_source_id=${source.id})`);
    return { upserted, sourceId: source.id, checksum };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const dbPath = process.env.ROHY_DB || path.join(repoRoot, 'server', 'database.sqlite');
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(dbPath, async (err) => {
        if (err) {
            console.error(`[seed-curated-medications] open ${dbPath}: ${err.message}`);
            process.exit(1);
        }
        try {
            await seedCuratedMedications(db);
            db.close();
        } catch (seedErr) {
            console.error(`[seed-curated-medications] failed: ${seedErr.message}`);
            db.close(() => process.exit(1));
        }
    });
}
