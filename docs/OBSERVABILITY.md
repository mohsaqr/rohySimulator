# Observability

This document describes the logging and diagnostic surface as it exists now.
It does not change retention or add a new sink.

## Server Components

Component names are the first argument to `logger('component')`.

| Component | Responsibility |
|---|---|
| `access` | One HTTP access log per request from `requestLoggerMiddleware`: method, path, status, duration, byte counts, user and tenant when available. |
| `audit` | Failures writing or verifying `system_audit_log`. |
| `auth` | Login, refresh, logout, active-session, and auth-cookie operational warnings. |
| `catalogue` | Drug/lab catalogue route audit failures. |
| `db` | SQLite startup and query instrumentation from `server/db.js` and `server/observability.js`. |
| `error-handler` | Final Express error middleware. |
| `http-out` | Outbound HTTP calls and retry/circuit-breaker outcomes. |
| `https` | Optional HTTPS listener and TLS file handling. |
| `kokoro` | Kokoro model load, warmup, and synthesis diagnostics. |
| `lab-database` | JSON-backed lab database load/search/save diagnostics. |
| `migration` | Schema migration and legacy voice-key migration status. |
| `observability` | Failures inside observability helpers, including structured-log write failures. |
| `radiology` | Radiology fixture database load. |
| `request` | Route-scoped logs using `req.log`, always carrying the request correlation id. |
| `routes-auth-users-tenants` | Auth, user, tenant, profile, and purge route family. |
| `routes-cases-sessions` | Case, session, body-map, and session-state route family. |
| `routes-orders-labs-radiology` | Orders, labs, radiology, treatments, and active effects route family. |
| `routes-llm-tts` | LLM proxy, platform LLM settings, TTS, voice settings, and provider integrations. |
| `routes-agent-tna-admin` | Agent templates, patient record, TNA analytics, and admin route family. |
| `seeder` | Default user/case seeding. |
| `server` | HTTP server boot, fatal process handlers, and top-level server errors. |

## Field Catalogue

Fields below are structured log keys currently emitted by active code.
`request_id` is the correlation key across browser, access logs, route logs,
SQLite logs, outbound HTTP logs, and `client_logs`.

| Field | Type | Meaning | PII |
|---|---:|---|---|
| `api_key` | string | Redacted/sentinel API key display value. | yes, redacted before logging |
| `agent_template_id` | number | Agent template selected for LLM config. | no |
| `agent_type` | string | Agent persona type. | no |
| `available_at` | string | Lab/order availability timestamp. | no |
| `base_url` | string | LLM base URL after query stripping. | no |
| `bytes_in`, `bytes_out` | number | Request/response byte counts. | no |
| `case_name`, `scenario_name`, `test_name` | string | Human-readable case/scenario/test names. | possible PII if user-authored |
| `clamped_value`, `min`, `max`, `value` | number | Vital value validation details. | clinical data |
| `code`, `status`, `http_status` | number/string | HTTP/process status code. | no |
| `component_hint` | string | Subcomponent hint on a request-scoped log. | no |
| `copied`, `count`, `row_count`, `result_count`, `cache_count`, `numeric_count`, `default_count`, `config_count`, `inserted`, `existing_users`, `existing_cases`, `textChars`, `text_chars`, `total_tokens` | number | Counts and sizes for operations. | no |
| `db_path`, `frontend_path`, `source`, `endpoint`, `target` | string | Local path or remote target for server diagnostics. Query strings are stripped from outbound targets. | path may be sensitive |
| `duration_ms`, `response_time_ms` | number | Operation latency. | no |
| `error`, `reason`, `fatal`, `stack`, `stderr` | string/boolean | Error details. `stack`/`stderr` should be treated as sensitive. | possible PII/secrets |
| `fallback_voice`, `requested_voice`, `voice`, `provider`, `model`, `temperature`, `max_tokens`, `maxOutputTokens` | string/number | Voice/LLM/TTS selection metadata. | no |
| `host`, `port`, `next_port` | string/number | Listener binding details. | no |
| `instant_results`, `default_turnaround`, `turnaround_minutes`, `turnaround_override`, `minutes_remaining` | number/boolean | Lab/order timing and readiness. | clinical workflow data |
| `is_ready`, `enabled`, `streaming` | boolean | Feature/request state. | no |
| `lab_id`, `lab_ids`, `orders`, `radiology_id`, `resourceId`, `session_id`, `user_id`, `tenant_id`, `last_id` | number/string/array | Internal identifiers for correlation and authorization scope. | user_id/session_id are pseudonymous identifiers |
| `method`, `path` | string | HTTP request method and path. Bodies are not logged. | path query may contain user-entered values |
| `migration`, `migrations`, `name`, `version`, `checksum`, `sql` | string/object | Migration status. Dry-run logs include migration SQL. | no |
| `old_key`, `new_key`, `override_keys`, `requested_test_name`, `resolved_test_name` | string/array | Configuration key and resolver metadata. | no |
| `request_id` | string | Request correlation id from browser or server. | no |
| `rows`, `sql_summary` | number/string | SQLite query result count and sanitized SQL summary. Parameters are not logged. | no |

PII-bearing database rows returned through admin/audit APIs must continue to
use `redactRow`, `redactRows`, `redactAuditPayload`, or related redaction
helpers. Request/response bodies and credentials must not be logged.

## Levels

| Level | Use |
|---|---|
| `debug` | High-volume diagnostics: SQL summaries, resolver details, lab search counts. Normally disabled outside deep debugging. |
| `info` | Expected lifecycle events: server listening, migrations applied, outbound call succeeded, usage recorded. |
| `warn` | Recoverable problems: fallback selected, non-fatal persistence failure, upstream retry/breaker, optional TLS unavailable. |
| `error` | Failed operation that affects the request, boot, persistence, or an external dependency. |

`LOG_LEVEL` controls the minimum level. `ROHY_LOG_LEVEL` is accepted as a
fallback when `LOG_LEVEL` is unset.

## Retention And Sinks

Server logs go to process stdout/stderr. Access logs, route logs, DB query
logs, and outbound HTTP logs are process logs only; they are not persisted by
the application.

Client logs submitted to `POST /api/client-logs/batch` are persisted in the
SQLite `client_logs` table. The app currently has no purge job for this table;
do not widen or shrink retention without a separate retention change.

`system_audit_log`, `learning_events`, `event_log`, `alarm_events`,
`llm_request_log`, and related operational tables keep their existing
retention/anonymisation behaviour.

## Reading Logs

In development on an interactive TTY, the logger emits a compact pretty form.
In test and production it emits newline-delimited JSON to stdout/stderr. Use
`request_id` to join:

1. Browser `X-Request-Id` generated by `src/services/apiClient.js`.
2. Server `access` log.
3. Route logs through `req.log`.
4. SQLite `db` debug logs and `http-out` logs.
5. Rows in `client_logs.request_id`.
