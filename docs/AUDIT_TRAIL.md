# Audit Trail

`system_audit_log` is the administrative audit trail. Phase 2 added a
tenant-scoped hash chain so direct database tampering after commit is
detectable.

## Schema

Current logical columns:

| Column | Meaning |
|---|---|
| `id` | SQLite autoincrement primary key. |
| `timestamp` | Audit event timestamp. New appends hash the same ISO timestamp they insert. |
| `user_id`, `username` | Actor identity when available. |
| `action` | Required action verb, for example user update or audit verification. |
| `resource_type`, `resource_id`, `resource_name` | Target resource. |
| `old_value`, `new_value` | JSON/text before and after payloads, redacted before write. |
| `ip_address`, `user_agent` | Request origin metadata. |
| `session_id` | Related simulation session when available. |
| `status`, `error_message` | Success/failure/warning state. |
| `metadata` | Additional structured context. |
| `tenant_id` | Tenant chain boundary. |
| `prev_hash` | Previous entry hash in the same tenant chain, or `NULL` for the first row. |
| `entry_hash` | SHA-256 hash of `prev_hash + canonical row`. |

`migrations/0008_audit_hash_chain.sql` creates
`idx_audit_log_tenant_id_chain` on `(tenant_id, id)`. The migration runner
adds `prev_hash` and `entry_hash` idempotently and backfills legacy rows.

## Canonicalisation

Implemented in `server/audit-chain.js`.

The canonical row includes only these logical fields:
`userId`, `action`, `resourceType`, `resourceId`, `resourceName`, `oldValue`,
`newValue`, `metadata`, `tenantId`, `ipAddress`, `userAgent`, and `ts`.

It excludes `id`, `created_at`, `prev_hash`, `entry_hash`, and any chain
metadata. JSON is deterministic: object keys are sorted recursively, arrays
keep order, values are encoded as UTF-8 JSON before hashing. JSON columns are
parsed before canonicalisation when possible; unparsable text is preserved as
text so verification remains deterministic.

## Append Algorithm

`appendAuditEntry(row, { database })` runs inside `BEGIN IMMEDIATE`:

1. Resolve `tenant_id`.
2. Read the newest row in that tenant ordered by `id DESC`.
3. Canonicalise the new row.
4. Compute `entry_hash = sha256(prev_hash || canonical_json)`.
5. Insert the row with `prev_hash` and `entry_hash`.
6. Commit.

SQLite serialises writers under `BEGIN IMMEDIATE`, so concurrent appends do
not race the previous-hash lookup.

## Verification

`verifyAuditChain({ tenant_id, database })` walks one tenant at a time:

1. Select rows for the tenant ordered by `id ASC`.
2. For each row, compare `row.prev_hash` to the hash computed for the
   previous row.
3. Recompute the current `entry_hash` from the stored logical fields.
4. Return `{ ok: false, brokenAt, expected, actual }` on the first mismatch.
5. Return `{ ok: true, lastVerifiedId }` when the chain validates.

Admins can call `GET /api/admin/audit/verify` to verify their tenant.

## Recovery When Broken

Treat a broken chain as a security incident. The chain can tell you where
integrity first failed; it cannot decide whether the row, previous row, or a
bulk rewrite caused the mismatch.

1. Freeze writes if possible.
2. Export the affected tenant's audit rows and application logs.
3. Run verification and record `brokenAt`, `expected`, and `actual`.
4. Compare against the latest known-good database backup.
5. Restore from backup when audit integrity is required for compliance.
6. If operations must continue without restore, start a new documented chain
   segment only after preserving the broken table for investigation.

See `docs/INCIDENT_RESPONSE.md` for the operational playbook.

## Limit

This protects against tampering after commit. It does not prevent a malicious
admin, compromised app server, or direct database writer from inserting a
future-looking forged row with a valid hash at insert time. The chain is
tamper-evident, not tamper-proof.
