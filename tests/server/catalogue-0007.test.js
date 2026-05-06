// Migration 0007 + tiered catalogue seeders integration test.
//
// Purpose: lock the schema shape and seeded counts so future refactors that
// touch the migration or any of the five seeders fail loudly instead of
// silently dropping rows. The earlier "Phase 1" regression-lock pattern
// applies here — each it() block represents a guarantee we want to keep.
//
// Strategy: spin up a temp sqlite DB via tests/utils/seedDb.js (which runs
// every migration including 0007), then run all five Session-1 seeders
// against it and assert the resulting state.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';
import { seedTreatmentEffects } from '../../scripts/seed-treatment-effects.js';
import { seedCuratedMedications } from '../../scripts/seed-curated-medications.js';
import { seedLabTestsFromJson } from '../../scripts/seed-lab-tests-from-json.js';
import { importLoincMapping } from '../../scripts/import-loinc-mapping.js';
import { seedPediatricRanges } from '../../scripts/seed-pediatric-ranges.js';

describe('migration 0007 + Session 1 catalogue seeders', () => {
    let ctx;

    beforeAll(async () => {
        ctx = await createTestDb({ label: 'catalogue-0007' });
        const silent = () => {};
        await seedTreatmentEffects(ctx.db, { log: silent });
        await seedCuratedMedications(ctx.db, { log: silent });
        await seedLabTestsFromJson(ctx.db, { log: silent });
        await importLoincMapping(ctx.db, { log: silent });
        await seedPediatricRanges(ctx.db, { log: silent });
    }, 30_000);

    afterAll(async () => {
        if (ctx) await ctx.cleanup();
    });

    describe('schema', () => {
        it('creates data_sources with the canonical source_keys', async () => {
            const rows = await ctx.all('SELECT source_key FROM data_sources ORDER BY source_key');
            const keys = rows.map((r) => r.source_key);
            expect(keys).toEqual(expect.arrayContaining([
                'admin', 'caliper_2026', 'curated', 'educator', 'loinc_v2.82',
                'openfda_v2026-05', 'rxnorm_v2026-05', 'student', 'ucum',
            ]));
            expect(rows.length).toBeGreaterThanOrEqual(9);
        });

        it('adds is_curated/scope/data_source_id columns to medications', async () => {
            const cols = await ctx.all('PRAGMA table_info(medications)');
            const names = cols.map((c) => c.name);
            for (const expected of ['is_curated', 'scope', 'tenant_id', 'data_source_id', 'rxcui', 'created_by']) {
                expect(names).toContain(expected);
            }
        });

        it('adds is_curated/scope/loinc_code/ucum_unit columns to lab_tests', async () => {
            const cols = await ctx.all('PRAGMA table_info(lab_tests)');
            const names = cols.map((c) => c.name);
            for (const expected of ['is_curated', 'scope', 'tenant_id', 'data_source_id', 'loinc_code', 'ucum_unit', 'created_by']) {
                expect(names).toContain(expected);
            }
        });

        it('adds rxcui/pk_source/pk_evidence_url columns to treatment_effects', async () => {
            const cols = await ctx.all('PRAGMA table_info(treatment_effects)');
            const names = cols.map((c) => c.name);
            for (const expected of ['rxcui', 'data_source_id', 'pk_source', 'pk_evidence_url']) {
                expect(names).toContain(expected);
            }
        });

        it('creates lab_reference_ranges, custom_drug_groups, custom_lab_groups tables', async () => {
            const tables = await ctx.all(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?, ?, ?)",
                ['lab_reference_ranges', 'custom_drug_groups', 'custom_drug_group_items', 'custom_lab_groups', 'custom_lab_group_items']
            );
            expect(tables.length).toBe(5);
        });
    });

    describe('treatment_effects seeder', () => {
        it('upserts ~100 curated rows', async () => {
            const { n } = await ctx.get('SELECT COUNT(*) AS n FROM treatment_effects');
            expect(n).toBeGreaterThanOrEqual(95);
            expect(n).toBeLessThanOrEqual(110);
        });

        it('stamps data_source_id pointing at the curated source', async () => {
            const { n } = await ctx.get(`
                SELECT COUNT(*) AS n FROM treatment_effects t
                JOIN data_sources s ON s.id = t.data_source_id
                WHERE s.source_key = 'curated'
            `);
            expect(n).toBeGreaterThanOrEqual(95);
        });

        it('records pk_source on most medication rows', async () => {
            const { n } = await ctx.get(
                "SELECT COUNT(*) AS n FROM treatment_effects WHERE treatment_type='medication' AND pk_source IS NOT NULL"
            );
            expect(n).toBeGreaterThanOrEqual(50);
        });

        it('preserves UNIQUE(treatment_name, route) — no duplicates after re-run', async () => {
            await seedTreatmentEffects(ctx.db, { log: () => {} });
            const dups = await ctx.all(`
                SELECT treatment_name, route, COUNT(*) AS n FROM treatment_effects
                GROUP BY treatment_name, route HAVING n > 1
            `);
            expect(dups).toEqual([]);
        });
    });

    describe('curated medications seeder', () => {
        it('inserts a medications row per medication-type treatment_effects row', async () => {
            const { n } = await ctx.get('SELECT COUNT(*) AS n FROM medications WHERE is_curated = 1');
            expect(n).toBeGreaterThanOrEqual(75);
            expect(n).toBeLessThanOrEqual(110);
        });

        it('back-fills treatment_effects.medication_id for medication-type rows', async () => {
            const { n } = await ctx.get(
                "SELECT COUNT(*) AS n FROM treatment_effects WHERE treatment_type='medication' AND medication_id IS NOT NULL"
            );
            // Not 100% match because of route-name normalisation edge cases
            // (e.g. "position" route on nursing rows) — but the medication
            // rows should join cleanly.
            expect(n).toBeGreaterThanOrEqual(70);
        });
    });

    describe('lab catalogue + LOINC importer', () => {
        it('seeds lab_tests from the JSON catalogue with curated provenance', async () => {
            const { n } = await ctx.get('SELECT COUNT(*) AS n FROM lab_tests WHERE is_curated = 1');
            expect(n).toBeGreaterThanOrEqual(195);
        });

        it('maps LOINC codes onto at least 90% of lab_tests', async () => {
            const { total } = await ctx.get('SELECT COUNT(*) AS total FROM lab_tests');
            const { mapped } = await ctx.get('SELECT COUNT(*) AS mapped FROM lab_tests WHERE loinc_code IS NOT NULL');
            expect(mapped / total).toBeGreaterThanOrEqual(0.9);
        });

        it('stamps ucum_unit on every LOINC-mapped row', async () => {
            const { n } = await ctx.get(
                'SELECT COUNT(*) AS n FROM lab_tests WHERE loinc_code IS NOT NULL AND ucum_unit IS NULL'
            );
            expect(n).toBe(0);
        });
    });

    describe('pediatric reference ranges', () => {
        it('inserts CALIPER ranges that fan out across matching lab_tests', async () => {
            const { n } = await ctx.get(`
                SELECT COUNT(*) AS n FROM lab_reference_ranges r
                JOIN data_sources s ON s.id = r.data_source_id
                WHERE s.source_key = 'caliper_2026'
            `);
            expect(n).toBeGreaterThanOrEqual(50);
        });

        it('covers neonatal + pediatric populations', async () => {
            const populations = await ctx.all(
                'SELECT DISTINCT population FROM lab_reference_ranges'
            );
            const set = new Set(populations.map((p) => p.population));
            expect(set.has('neonatal')).toBe(true);
            expect(set.has('pediatric')).toBe(true);
        });

        it('every range row has a unit and source citation', async () => {
            const { n } = await ctx.get(
                "SELECT COUNT(*) AS n FROM lab_reference_ranges WHERE unit IS NULL OR unit = '' OR source IS NULL"
            );
            expect(n).toBe(0);
        });

        it('refresh deletes prior caliper rows then re-inserts (idempotent)', async () => {
            const before = await ctx.get(`
                SELECT COUNT(*) AS n FROM lab_reference_ranges r
                JOIN data_sources s ON s.id = r.data_source_id WHERE s.source_key = 'caliper_2026'
            `);
            await seedPediatricRanges(ctx.db, { log: () => {} });
            const after = await ctx.get(`
                SELECT COUNT(*) AS n FROM lab_reference_ranges r
                JOIN data_sources s ON s.id = r.data_source_id WHERE s.source_key = 'caliper_2026'
            `);
            expect(after.n).toBe(before.n);
        });
    });

    describe('data_sources provenance', () => {
        it('records rows_imported on each source after seeders run', async () => {
            const rows = await ctx.all(`
                SELECT source_key, rows_imported FROM data_sources
                WHERE source_key IN ('curated', 'loinc_v2.82', 'caliper_2026')
            `);
            const map = Object.fromEntries(rows.map((r) => [r.source_key, r.rows_imported]));
            expect(map['curated']).toBeGreaterThanOrEqual(95);
            expect(map['loinc_v2.82']).toBeGreaterThanOrEqual(150);
            expect(map['caliper_2026']).toBeGreaterThanOrEqual(50);
        });
    });
});
