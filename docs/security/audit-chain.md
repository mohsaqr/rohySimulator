# Audit chain

Rohy keeps a **tamper-evident** audit log: every entry is SHA-256
hash-chained to its predecessor, so any retroactive edit, deletion, or
reordering breaks the chain and is detectable. The implementation is
`server/audit-chain.js`; the schema lands in migration
`0008_audit_hash_chain.sql`.

## What is recorded

Audit entries are written to `system_audit_log`. Each row carries:

- `timestamp`, `user_id`, `username`, `action`
- `resource_type`, `resource_id`, `resource_name`
- `old_value`, `new_value` (the before/after of a sensitive mutation)
- `metadata`, `ip_address`, `user_agent`, `session_id`
- `status` (default `success`), `error_message`
- `tenant_id`
- `prev_hash`, `entry_hash` — the chain columns

Sensitive mutations across the platform append through `appendAuditEntry()`.
The retention sweep also writes its own audit row each run (see
[Data retention](/security/retention)). The Oyon integration plan routes
its compliance-weight events — consent granted/revoked, research export,
per-tenant enablement, purge completion — into this same chain so that
tampering with them is equally detectable (see
[Oyon &amp; EU AI Act](/security/oyon-ai-act)).

::: tip
`old_value`, `new_value`, and `metadata` are JSON columns. They pass through
the redaction policy (`redactAuditPayload`) before any audit row is returned
in an API response, so secrets embedded in a diff are scrubbed on read. See
[Redaction &amp; PII](/security/redaction).
:::

## How the chain is computed

Each entry's hash is computed over a **canonical** serialization, so the
hash is stable regardless of column order or JSON key order:

1. `canonicalRow()` normalizes the row into a fixed set of logical fields
   (`action`, `ipAddress`, `metadata`, `newValue`, `oldValue`,
   `resourceId`, `resourceName`, `resourceType`, `tenantId`, `ts`,
   `userAgent`, `userId`), recursively sorting object keys
   (`stableValue` / `stableStringify`).
2. `computeEntryHash(prevHash, canonicalJson)` returns
   `sha256(prevHash ?? '' + canonicalJson)` as hex.
3. The new row stores both `prev_hash` (the previous entry's `entry_hash`)
   and its own `entry_hash`.

The chain is **per tenant**: the predecessor lookup is scoped to the same
`tenant_id`, so each tenant has an independent, ordered hash chain. The
first entry in a tenant's chain has `prev_hash = NULL`.

`backfillAuditChain()` retro-fills `prev_hash` / `entry_hash` for rows that
predate the chain columns, ordered by `(tenant_id, id)`, continuing from any
already-hashed predecessor.

## Dedicated connection rationale

The audit chain uses its **own dedicated SQLite connection**, not the
shared `db.js`/`dbAdapter` handle. This is deliberate and load-bearing:

- Other routes run their own `BEGIN`/`COMMIT` on the shared connection,
  sometimes fire-and-forget. A silently failed `COMMIT` leaves the shared
  connection stuck in a pending transaction.
- Audit's `BEGIN IMMEDIATE` on a poisoned shared connection would throw
  *"cannot start a transaction within a transaction"*, the connection would
  stay poisoned, and every subsequent operation would block on the writer
  lock until the event loop starved and the proxy returned 502.

With a private handle, route transaction state **cannot** affect audit
transaction state. SQLite tracks transaction state per connection; the file
lock layer already serializes cross-connection writes. The dedicated handle
matches the primary connection's `journal_mode=WAL` and
`busy_timeout=5000` so it does not trip `BUSY` reading mid-write.

An **in-process FIFO append mutex** (`withAppendLock`) ensures only one
`BEGIN IMMEDIATE`/`INSERT`/`COMMIT` cycle runs at a time, so concurrent
fire-and-forget appends (e.g. saving four voice settings at once) cannot
collide on the same connection. Inserts are microsecond-scale, so the queue
never grows. A defense-in-depth guard catches the
"transaction within a transaction" signature, rolls back, and retries with
a loud warning log if the dedicated-connection invariant is ever broken.

## Integrity verification

`verifyAuditChain({ tenant_id })` walks a tenant's chain in `id` order and
recomputes every hash:

- For each row it checks `row.prev_hash` equals the running previous
  `entry_hash`, and `row.entry_hash` equals
  `computeEntryHash(prevHash, canonicalRow(row))`.
- On the first mismatch it returns
  `{ ok: false, brokenAt, expected, actual }` — `brokenAt` is the `id` of
  the first row that does not verify.
- A fully intact chain returns `{ ok: true, lastVerifiedId }`.

::: danger
A failing `verifyAuditChain` result means the audit log has been altered,
truncated, or reordered since it was written. Treat a non-`ok` result as a
**security incident**, not a data-quality bug — investigate the host, not
the database. Re-running `backfillAuditChain` would *recompute* hashes over
the tampered data and **mask the evidence**; do not do this in response to a
verification failure.
:::

Run `bash scripts/audit-auditlog.sh` against a live server to exercise the
audit-log surface as part of deploy verification (see the
[Hardening checklist](/security/hardening)).
