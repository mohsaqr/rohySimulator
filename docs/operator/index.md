# Running Rohy in Production

For the **operator / DevOps** — install, deploy, update and recover Rohy.

The operator manuals, reconciled into VitePress-safe pages:

- [Install](/operator/install) — five installation paths
- [Deploy & harden](/operator/deploy) — TLS, reverse proxy, security checklist
- [Update](/operator/updating) — `bin/rohy-update` and rollback
- [Update strategy](/operator/update-strategy) — the rationale

## Runbook library

| Page | What it covers |
|---|---|
| [Backup & restore](/operator/backup-restore) | VACUUM-INTO snapshots, restore drills |
| [Migrations runbook](/operator/migrations) | Applying/auditing migrations safely |
| [Retention & purges](/operator/retention) | `retention-sweep.js`, per-tenant windows |
| [Observability](/operator/observability) | NDJSON logs, slow queries, request IDs |
| [Incident playbooks](/operator/incidents) | Wedged DB, failed update, TTS outage |

> Manuals re-homed and runbooks authored in **Stage 3 (G4)** — milestone **M2**.
