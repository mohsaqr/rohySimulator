# Redaction &amp; PII

Rohy has **one** place that decides which response fields are stripped,
masked, or hidden before any payload leaves the server:
`server/redaction.js`. There is no second redaction path, and call sites
must not `delete obj.foo` ad hoc.

## Why a single policy

Sensitive data leaks happen when redaction is scattered: one handler
remembers to strip `apiKey`, another forgets, a third strips it under a
different name. Centralizing the rule in `RESPONSE_REDACTION_POLICY` means:

- The set of protected fields is auditable in one file.
- Every reader (`redactRow`, `redactRows`,
  `redactPlatformSettingRow(s)`, `redactAuditPayload`) applies the **same**
  rule, including nested JSON columns.
- Adding a sensitive field anywhere in the schema is a one-line policy
  edit, not a hunt through every route handler.

This is also a documented product constraint: the support/diagnostics
bundle and any new response shape carrying secrets/PII must pass through
`server/redaction.js` (see [Contributing](/contributing) and the
[Glossary](/reference/glossary) entry for *Redaction*).

## Field classes and actions

Each policy entry has a `class` and an `action`:

| Class | Meaning | Actions used |
|---|---|---|
| `secret` | Credentials and tokens | `redact` (replace value with `[redacted]` when truthy) or `hide` (drop the key entirely) |
| `json` | JSON-bearing columns that may *contain* secrets | `redact-json` (parse, recursively scrub any nested key matching the secret pattern, re-serialize) |
| `pii` | Personally identifying fields | `mask-email-domain` (keep local-part, replace domain with `[redacted]`) or `redact` |
| `internal` | Internal bookkeeping not for clients | `redact` or `hide` |

Concrete entries (from `RESPONSE_REDACTION_POLICY`):

- **Secrets** — `apiKey`, `api_key`, `llm_api_key` are `redact`;
  `password_hash`, `refresh_token`, `token_hash`, `token` are `hide`
  (the key is removed, not just blanked).
- **JSON columns** — `llm_settings`, `default_llm_settings`,
  `notification_settings`, `default_monitor_settings`, `monitor_settings`,
  `settings_snapshot`, `settings_json`, `old_value`, `new_value`,
  `metadata` are recursively scrubbed.
- **PII** — `email`, `user_email`, `alternative_email` are
  `mask-email-domain`; `phone`, `address`, `name`, `student_name`,
  `education`, `grade` are `redact`.
- **Internal** — `updated_by`, `created_by` are `redact`; `role_rank` is
  `hide`.

In addition to the explicit policy, any key matching the secret-key pattern
`/(^|[_-])(api[_-]?key|key|secret|token)$|password/i` is redacted even
without an explicit entry (defense-in-depth). `setting_key` is explicitly
exempted so platform-setting *names* are not mangled. Keys in the
`PII_COLUMNS` set without an explicit policy default to `pii` / `redact`.

## Classification gates (`pii` / `internal`)

`redactRow(row, classification)` accepts a `classification` object. By
default both `pii` and `internal` are `'allow'` — i.e. an authorized,
same-tenant reader can see PII and internal fields. A caller that passes
`{ pii: 'deny' }` (or anything other than `'allow'`) forces the masking
action for that class. This is how a less-privileged or cross-context
reader gets a redacted view from the **same** policy, rather than each
handler reimplementing "should this caller see emails".

Platform settings get a dedicated path: `redactPlatformSettingRow` redacts
the whole `setting_value` when the `setting_key` matches the secret pattern,
otherwise scrubs it as JSON. Audit payloads use `redactAuditPayload`, which
is `redactJsonColumn` applied to `old_value`/`new_value`/`metadata` so a
secret captured in an audit diff is never returned (see
[Audit chain](/security/audit-chain)).

## Why call sites must not delete fields ad hoc

::: danger
Do **not** add `delete row.someField` in a route handler. An ad-hoc delete:

- is invisible to anyone auditing `server/redaction.js`,
- does not cover the field when it appears nested inside a JSON column,
- does not cover the field on other endpoints that return the same row,
- silently rots when the field is renamed.

Every redaction decision must be expressed as a policy entry so the single
file remains the complete, verifiable list of what is protected.
:::

## Registering a new sensitive field

When you add a column or response field that carries a secret, PII, or
internal data:

1. Add an entry to `RESPONSE_REDACTION_POLICY` in `server/redaction.js`
   with the correct `class` and `action`. Use `hide` for things that
   should never appear in any response (token hashes, password hashes);
   use `redact`/`mask-email-domain` for fields a privileged reader may
   still need in a blanked form.
2. If the value can also appear **inside** a JSON column (e.g. nested in
   `settings_json`), confirm its key matches the secret-key pattern or add
   handling — `redactJsonColumn` recurses but only auto-scrubs keys that
   match the pattern.
3. Ensure the reading endpoint actually calls `redactRow` / `redactRows`
   (or the platform-setting / audit variant) rather than returning raw
   rows.
4. Verify with `bash scripts/audit-redaction.sh` against a running server
   — it asserts the data-classification contract end to end (see the
   [Hardening checklist](/security/hardening)).

Cross-reference the secret-bearing environment variables in the
[config reference](/reference/config/); those values must never be echoed
into a response either, which is what the secret-key pattern backstops.
