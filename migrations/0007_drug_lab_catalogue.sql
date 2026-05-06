-- Tiered drug + lab catalogue (curated essentials | custom additions | searchable live).
--
-- Companion plan in memory: project_drug_lab_catalogue_plan.md.
-- Why this migration adds *columns and provenance tables*, not new content:
--   The catalogue rows themselves come from JSON-driven seeders run after
--   migration (scripts/seed-treatment-effects.js, scripts/seed-curated-medications.js,
--   scripts/seed-pediatric-ranges.js, scripts/import-loinc-mapping.js).
--   Keeping the schema change separate from the data load lets us refresh
--   curated content over time (re-run the seeder) without re-applying a
--   migration. The schema_migrations table only tracks structure.
--
-- SQLite-specific notes:
--   - ALTER TABLE ADD COLUMN requires a DEFAULT or NULL allowance; we cannot
--     attach CHECK constraints via ALTER. Scope-validity is enforced in the
--     route layer (see plan section "Route changes").
--   - The migration runner wraps this file in a transaction (server/migrationRunner.js).

-- ---------------------------------------------------------------------------
-- Provenance: every imported row references a row in data_sources.
-- One-shot pinned snapshot strategy — no cron, no auto-refresh. Refreshes
-- happen via `node scripts/import-rxnorm.js --release=YYYY-MM --replace`
-- which rotates the snapshot row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT UNIQUE NOT NULL,
    source_url TEXT NOT NULL,
    release_version TEXT NOT NULL,
    license TEXT NOT NULL,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    checksum_sha256 TEXT,
    imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    imported_by INTEGER REFERENCES users(id),
    notes TEXT
);

-- Seed the canonical source rows up front so seeders can FK to them by key.
-- These are deterministic placeholders; seeders update rows_imported + checksum.
INSERT OR IGNORE INTO data_sources (source_key, source_url, release_version, license, rows_imported, notes)
VALUES
    ('curated',         'https://github.com/mohsaqr/rohySimulator',    'rohy-2026-05', 'Project-internal',          0, 'Hand-curated by Rohy team with PK/range citations'),
    ('rxnorm_v2026-05', 'https://rxnav.nlm.nih.gov/REST/',              '2026-05',      'Public domain (NLM)',       0, 'Pinned snapshot for medication search proxy'),
    ('openfda_v2026-05','https://api.fda.gov/drug/label.json',          '2026-05',      'CC0 1.0 (FDA)',             0, 'Pinned snapshot for boxed warnings, indications, SE'),
    ('loinc_v2.82',     'https://loinc.org',                             '2.82',         'Free, attribution required', 0, 'LOINC test codes mapped onto curated lab_tests'),
    ('ucum',            'https://ucum.org',                              'HL7/ISO',      'Public, HL7/ISO',           0, 'Unit normalisation for lab results'),
    ('caliper_2026',    'https://caliperdatabase.com',                  '2026',         'CC BY-NC-SA',               0, 'Pediatric reference ranges; isolated and droppable for commercial deploys'),
    ('admin',           'internal://admin-form',                         'live',         'Project-internal',          0, 'Admin-added rows via Settings UI'),
    ('educator',        'internal://educator-form',                      'live',         'Project-internal',          0, 'Educator-added rows scope=tenant'),
    ('student',         'internal://student-form',                       'live',         'Project-internal',          0, 'Student-added rows scope=user');

-- ---------------------------------------------------------------------------
-- Medications: scope-aware + provenance + canonical-id columns.
-- scope values: 'platform' | 'tenant' | 'user' | 'session' (enforced in routes).
-- ---------------------------------------------------------------------------
ALTER TABLE medications ADD COLUMN is_curated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE medications ADD COLUMN data_source_id INTEGER REFERENCES data_sources(id);
ALTER TABLE medications ADD COLUMN scope TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE medications ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE medications ADD COLUMN external_source TEXT;
ALTER TABLE medications ADD COLUMN external_id TEXT;
ALTER TABLE medications ADD COLUMN rxcui TEXT;
ALTER TABLE medications ADD COLUMN ndc_primary TEXT;
ALTER TABLE medications ADD COLUMN atc_code TEXT;
ALTER TABLE medications ADD COLUMN openfda_setid TEXT;
ALTER TABLE medications ADD COLUMN boxed_warning TEXT;
ALTER TABLE medications ADD COLUMN created_by INTEGER REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- Treatment effects: PK provenance fields. RxCUI links a sim-active drug to
-- its catalogue + RxNorm canonical id without joining medications.
-- ---------------------------------------------------------------------------
ALTER TABLE treatment_effects ADD COLUMN rxcui TEXT;
ALTER TABLE treatment_effects ADD COLUMN data_source_id INTEGER REFERENCES data_sources(id);
ALTER TABLE treatment_effects ADD COLUMN pk_source TEXT;
ALTER TABLE treatment_effects ADD COLUMN pk_evidence_url TEXT;

-- ---------------------------------------------------------------------------
-- Lab tests: scope-aware + LOINC + UCUM mapping.
-- ---------------------------------------------------------------------------
ALTER TABLE lab_tests ADD COLUMN is_curated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_tests ADD COLUMN data_source_id INTEGER REFERENCES data_sources(id);
ALTER TABLE lab_tests ADD COLUMN scope TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE lab_tests ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lab_tests ADD COLUMN external_source TEXT;
ALTER TABLE lab_tests ADD COLUMN loinc_code TEXT;
ALTER TABLE lab_tests ADD COLUMN ucum_unit TEXT;
ALTER TABLE lab_tests ADD COLUMN created_by INTEGER REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- Pediatric (and other-population) reference ranges. One lab_test can have
-- many ranges (adult, pediatric-by-age-band, neonatal, pregnancy).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_reference_ranges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_test_id INTEGER NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
    population TEXT NOT NULL CHECK(population IN ('adult', 'pediatric', 'neonatal', 'pregnancy', 'geriatric')),
    sex TEXT CHECK(sex IN ('M', 'F', 'all') OR sex IS NULL),
    age_min_years REAL,
    age_max_years REAL,
    range_low REAL,
    range_high REAL,
    critical_low REAL,
    critical_high REAL,
    unit TEXT NOT NULL,
    source TEXT NOT NULL,
    source_citation TEXT,
    data_source_id INTEGER REFERENCES data_sources(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Custom drug groups: user-defined collections (e.g. "ICU sepsis bundle").
-- scope governs visibility identically to medications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_drug_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL DEFAULT 'platform',
    tenant_id INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS custom_drug_group_items (
    group_id INTEGER NOT NULL REFERENCES custom_drug_groups(id) ON DELETE CASCADE,
    medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, medication_id)
);

-- ---------------------------------------------------------------------------
-- Custom lab groups: same shape as drug groups but for lab_tests.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_lab_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL DEFAULT 'platform',
    tenant_id INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS custom_lab_group_items (
    group_id INTEGER NOT NULL REFERENCES custom_lab_groups(id) ON DELETE CASCADE,
    lab_test_id INTEGER NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, lab_test_id)
);

-- ---------------------------------------------------------------------------
-- Indices: scope queries run on every list endpoint, so filter on
-- (scope, created_by) for "my catalogue" views and on canonical ids for
-- search-result deduplication.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_medications_rxcui          ON medications(rxcui);
CREATE INDEX IF NOT EXISTS idx_medications_scope_user     ON medications(scope, created_by);
CREATE INDEX IF NOT EXISTS idx_medications_tenant         ON medications(tenant_id, scope);
CREATE INDEX IF NOT EXISTS idx_lab_tests_loinc            ON lab_tests(loinc_code);
CREATE INDEX IF NOT EXISTS idx_lab_tests_scope_user       ON lab_tests(scope, created_by);
CREATE INDEX IF NOT EXISTS idx_lab_tests_tenant           ON lab_tests(tenant_id, scope);
CREATE INDEX IF NOT EXISTS idx_lab_ranges_test            ON lab_reference_ranges(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_ranges_population      ON lab_reference_ranges(lab_test_id, population);
CREATE INDEX IF NOT EXISTS idx_drug_groups_scope          ON custom_drug_groups(scope, created_by);
CREATE INDEX IF NOT EXISTS idx_lab_groups_scope           ON custom_lab_groups(scope, created_by);
CREATE INDEX IF NOT EXISTS idx_treatment_effects_rxcui    ON treatment_effects(rxcui);
