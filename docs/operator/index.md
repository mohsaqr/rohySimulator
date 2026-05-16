# Running Rohy in Production

For the **operator / DevOps** — install, deploy, update and recover Rohy.

The existing operator manuals remain authoritative in the repository while
Stage 3 (G4) reconciles them into VitePress-safe runbook pages:

- [Install ↗](https://github.com/mohsaqr/rohy/blob/main/docs/INSTALL.md) — five installation paths
- [Deploy & harden ↗](https://github.com/mohsaqr/rohy/blob/main/docs/DEPLOY.md) — TLS, reverse proxy, security checklist
- [Update ↗](https://github.com/mohsaqr/rohy/blob/main/docs/UPDATING.md) — `bin/rohy-update` and rollback
- [Update strategy ↗](https://github.com/mohsaqr/rohy/blob/main/docs/UPDATE-STRATEGY.md) — the rationale

## Runbook library

| Page | What it covers |
|---|---|
| [Backup & restore](/operator/backup-restore) | VACUUM-INTO snapshots, restore drills |
| [Migrations runbook](/operator/migrations) | Applying/auditing migrations safely |
| [Retention & purges](/operator/retention) | `retention-sweep.js`, per-tenant windows |
| [Observability](/operator/observability) | NDJSON logs, slow queries, request IDs |
| [Incident playbooks](/operator/incidents) | Wedged DB, failed update, TTS outage |

> Existing manuals re-homed in **Stage 0**; runbooks authored in **Stage 3 (G4)** — milestone **M2**.
