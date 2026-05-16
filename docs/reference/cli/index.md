# CLI & Ops Reference

> Generated from source by `scripts/docs-gen/gen-cli.mjs`. Do not edit by hand — regenerate with `npm run docs:gen:cli`.

## Update tool (`bin/rohy-update`)

Operator-driven, backup-first upgrade path. One CLI, 5 subcommands. Never executed by this generator — parsed from source.

### Subcommands

| Subcommand | Aliases | Usage |
| --- | --- | --- |
| `check` | — | rohy-update check                    # is there an update? what changes? |
| `apply` | — | rohy-update apply [--yes] [--allow-destructive] |
| `rollback` | — | rohy-update rollback                 # undo the last apply |
| `list-backups` | `list` | rohy-update list-backups             # show local snapshots |
| `restore-backup` | — | rohy-update restore-backup &lt;name&gt;    # restore a specific snapshot |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success (apply succeeded, or check found no update, etc.) |
| `10` | check found an update available (caller can act on this) |
| `1` | user-recoverable failure (caller can retry; usually rolled back) |
| `2` | catastrophic failure (rolled back to old version manually required) |
| `3` | usage error |

### Configuration (env vars or `/etc/rohy/update.conf`)

| Variable | Default | Description |
| --- | --- | --- |
| `ROHY_BACKUP_DIR` | `/var/backups/rohy` | where snapshots live |
| `ROHY_DB` | `/opt/data/rohy/database.sqlite` | where the DB lives |
| `ROHY_ENV_FILE` | `/etc/rohy/env` | systemd EnvironmentFile |
| `ROHY_INSECURE` | `0` | accept self-signed in verify |
| `ROHY_REPO_DIR` | `$REPO_DEFAULT` | where the source lives |
| `ROHY_SERVICE` | `rohy` | systemd service name |
| `ROHY_UPDATE_BRANCH` | `main` | git ref to track |
| `ROHY_VERIFY_URL` | `https://localhost:4001/rohy` | URL POST_VERIFY tests against |

## Database & data scripts

| Command | Purpose | Invocation |
| --- | --- | --- |
| `migrate.js` | Apply pending SQL migrations from migrations/ (inferred) | `node scripts/migrate.js` |
| `seed.js` | Standalone seed runner | `node scripts/seed.js` |
| `retention-sweep.js` | Delete time-bounded log rows past the retention horizon (inferred) | `node scripts/retention-sweep.js` |
| `import-loinc-mapping.js` | Map LOINC codes + UCUM units onto the existing lab_tests rows | `node scripts/import-loinc-mapping.js` |
| `seed-curated-medications.js` | Seed / refresh `medications` catalogue from server/data/treatment_effects.json | `node scripts/seed-curated-medications.js` |
| `seed-lab-tests-from-json.js` | Mirror Lab_database.json (+ heart.txt) into the lab_tests SQL table | `node scripts/seed-lab-tests-from-json.js` |
| `seed-pediatric-ranges.js` | Seed lab_reference_ranges with pediatric overlay for tests we already curate | `node scripts/seed-pediatric-ranges.js` |
| `seed-treatment-effects.js` | Seed / refresh `treatment_effects` from server/data/treatment_effects.json | `node scripts/seed-treatment-effects.js` |
| `import-drugs.cjs` | Import drugs from local JSONL file | `node server/scripts/import-drugs.cjs` |
| `seed-acute-cases.cjs` | Seed script: State-of-the-Art Acute Clinical Cases | `node server/scripts/seed-acute-cases.cjs` |

## Audit & verification scripts

Each boots/probes a running server and asserts a subsystem contract. 18 audit scripts discovered.

| Script | Purpose |
| --- | --- |
| `scripts/audit-alarms.sh` | End-to-end audit of alarm + notification wiring shipped in the Stage-3 audit |
| `scripts/audit-auditlog.sh` | End-to-end audit for Stage E4 system_audit_log coverage |
| `scripts/audit-auth.sh` | End-to-end audit of auth + user-prefs fixes shipped in Stage 7 |
| `scripts/audit-investigations.sh` | End-to-end audit of the lab + radiology investigations wiring shipped in the Stage-2 audit |
| `scripts/audit-llm.sh` | End-to-end audit of the LLM precedence chain shipped in the Stage-4 audit |
| `scripts/audit-migrations.sh` | End-to-end migration framework audit for Stage E2 |
| `scripts/audit-observability.sh` | End-to-end audit for Stage E9 observability hooks |
| `scripts/audit-physexam.sh` | End-to-end audit of physical-exam idempotency shipped in Stage 6 |
| `scripts/audit-portability.sh` | Inventory audit for Stage E8 database portability infrastructure |
| `scripts/audit-rbac.sh` | End-to-end audit for Stage E3 role hierarchy and centralized RBAC checks |
| `scripts/audit-redaction.sh` | Stage E5 contract audit for response data classification and redaction |
| `scripts/audit-retention.sh` | End-to-end audit for Stage E7 retention and user purge |
| `scripts/audit-scenario.sh` | End-to-end audit of the scenario engine fixes shipped in Stage 5 |
| `scripts/audit-schema.sh` | End-to-end schema integrity audit for Stage E1 |
| `scripts/audit-sessions.sh` | End-to-end audit of session lifecycle wiring shipped in the Stage-1 audit |
| `scripts/audit-tenant.sh` | End-to-end audit for Stage E6 tenant readiness |
| `scripts/audit-tna.sh` | End-to-end audit of TNA / learning-events IDOR fixes shipped in Stage 8 |
| `scripts/audit-voices.sh` | End-to-end audit of TTS provider routing, stream alignment, and shipped persona/avatar data integrity |

### Deploy verification

| Script | Purpose |
| --- | --- |
| `scripts/tech-test.sh` | comprehensive technical verification of a rohy deploy |
| `scripts/post-verify-rohy.sh` | POST_VERIFY hook wrapper that mints a fresh auth token before invoking tech-test.sh so the Oyon contract probe (section 6 of tech-test.sh) actually fires every deploy |
| `scripts/smoke.sh` | Post-deploy smoke check. Run after rsync'ing rohy to the server + `systemctl restart rohy` to verify the service came back healthy |

## Relevant npm scripts

| Script | Command |
| --- | --- |
| `npm run docs:gen:api` | `node scripts/docs-gen/gen-api.mjs` |
| `npm run docs:gen:cli` | `node scripts/docs-gen/gen-cli.mjs` |
| `npm run docs:gen:config` | `node scripts/docs-gen/gen-config.mjs` |
| `npm run docs:gen:data` | `node scripts/docs-gen/gen-data.mjs` |
| `npm run install:piper` | `bash server/scripts/install-piper.sh` |
| `npm run oyon:update` | `bash scripts/update-oyonr.sh` |
| `npm run production` | `NODE_ENV=production node server/server.js` |
| `npm run setup:oyon` | `bash OyonR/scripts/download-models.sh` |

---

Regenerate this page: `npm run docs:gen:cli`
