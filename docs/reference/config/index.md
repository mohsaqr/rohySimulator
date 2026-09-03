# Config &amp; environment reference

Every environment variable Rohy reads, scanned **from source** across `server/**`, `bin/**`, and `scripts/**`, cross-referenced against `server/config/validateEnv.js` for required-ness and recommended-in-production hints.

::: tip Regenerate
This page is generated. Do not hand-edit. Re-run `npm run docs:gen:config` after changing env usage or the validator.
:::

::: warning Security-sensitive variables
The following variables carry credentials or signing material. Never commit them, log them, or expose them to the browser. Store them in the operator env file with restricted permissions:

- `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN`
- `GOOGLE_API_KEY`
- `GOOGLE_TTS_API_KEY`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `ROHY_ADMIN_PASSWORD`
- `ROHY_CONTENT_TOKEN`
- `ROHY_PASSWORD`
- `ROHY_PLUGIN_ORIGIN_TOKENS`
- `ROHY_TOKEN`
:::

## Core server

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `HTTPS_PORT` | No | — | HTTPS listen port (used when TLS cert/key are set). | `server/server.js:56` |
| `NODE_ENV` | No | `development` | Runtime mode; `production` tightens defaults and enables prod-only validation. | `server/logger.js:40`<br>`server/logger.js:41`<br>`server/middleware/csrf.js:71`<br>_+11 more_ |
| `PORT` | No | — | HTTP listen port. | `server/server.js:48` |

## Auth/security

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ALLOW_DEFAULT_USERS` | No | — | Bootstrap-only flag to seed default users on first boot. | `server/seeders/users.js:111` |
| `GITHUB_TOKEN` | No | — | Fallback credential for `npm run setup:content` when ROHY_CONTENT_TOKEN is unset. Install-time only; no runtime code reads it. **⚠ secret — see security note above.** | `scripts/setup-content.mjs:92` |
| `JWT_EXPIRY` | No | `7d` | Lifetime of issued JWTs. | `server/middleware/authTtl.js:42` |
| `JWT_SECRET` | Yes | — | Secret used to sign/verify auth + audit tokens. Fatal if unset. _Fatal if unset (validateEnv pushes an error)._ **⚠ secret — see security note above.** | `server/middleware/auth.js:16` |
| `ROHY_ADMIN_EMAIL` | No | — | Email for the provisioned first admin. Defaults to &lt;username&gt;@rohy.local. | `server/seeders/users.js:58` |
| `ROHY_ADMIN_NAME` | No | — | Display name for the provisioned first admin. Defaults to "System Administrator". | `server/seeders/users.js:59` |
| `ROHY_ADMIN_PASSWORD` | No | — | Password for the provisioned first admin. Must satisfy the normal password policy or the seeder refuses it. **⚠ secret — see security note above.** | `server/seeders/users.js:57` |
| `ROHY_ADMIN_USERNAME` | No | — | Provisions the first admin on first boot (with ROHY_ADMIN_PASSWORD). Applied only while the users table is empty. | `server/seeders/users.js:56` |
| `ROHY_CONTENT_TOKEN` | No | — | A GitHub token with read access to the content repository, read by `npm run setup:content` if set. The content repository is now PUBLIC, so no credential is needed and this variable can be left unset; it remains supported for a deployment that mirrors the archives behind its own private release. Install-time only: nothing at runtime reads it. `GITHUB_TOKEN` is accepted as a fallback, as is the `gh` CLI when the machine is logged in. Installing from a local file with `--from` needs no token at all, because the installer trusts the archive's SHA-256 rather than the host it came from. **⚠ secret — see security note above.** | `scripts/setup-content.mjs:92` |
| `ROHY_DISABLE_AUTH_RATE_LIMIT` | No | — | Disables the auth-endpoint rate limiter (dev/test). | `server/routes/auth-routes.js:80`<br>`server/routes/registration-routes.js:38` |
| `ROHY_PLUGIN_ORIGIN_TOKENS` | No | — | Comma-separated `&lt;pluginId&gt;=&lt;token&gt;` credentials rohy presents to each plugin content origin, so an origin can be closed to the public rather than merely unadvertised. Sent only on rohy's own server-to-server fetch as `Authorization: Bearer &lt;token&gt;` — never returned to a browser, never logged, and never the caller's own credential: the proxy forwards no cookies, no Authorization header and no query string from the learner. Per DEPLOYMENT rather than per user, so one installation's access can be revoked without touching the others. Unset means the origin is fetched anonymously, which is correct for a public origin. Malformed is fatal at boot. **⚠ secret — see security note above.** | `server/lib/pluginOriginTokens.js:84` |
| `ROHY_TOKEN` | No | — | _see source_ **⚠ secret — see security note above.** | `scripts/llm-language-smoke.mjs:47`<br>`scripts/translate-locales.mjs:77` |
| `ROHY_TRUST_PROXY` | No | `loopback` | Express `trust proxy` setting (proxy hop count / IP / preset). | `server/server.js:65` |
| `TLS_CERT_PATH` | No | `'' (empty string)` | Path to TLS certificate; must be paired with `TLS_KEY_PATH`. _Conditionally required: if either of TLS_CERT_PATH / TLS_KEY_PATH is set, both must be._ | `server/routes/help-routes.js:130`<br>`server/server.js:57` |
| `TLS_KEY_PATH` | No | `'' (empty string)` | Path to TLS private key; must be paired with `TLS_CERT_PATH`. _Conditionally required: if either of TLS_CERT_PATH / TLS_KEY_PATH is set, both must be._ | `server/routes/help-routes.js:130`<br>`server/server.js:58` |

## Database

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ROHY_DB` | No | — | Absolute path to the SQLite database file. _Recommended in production (validateEnv warns when unset)._ _Recommended in production (DB otherwise lives inside the repo tree)._ | `scripts/import-loinc-mapping.js:108`<br>`scripts/migrate.js:10`<br>`scripts/nuke-30-tats.js:34`<br>_+7 more_ |
| `ROHY_KB_DB` | No | — | Where the derived knowledge base is written (default `data/knowledge.db`). Tooling only — the server never reads it. Set it to build a scratch copy without clobbering the real one, which is what the parser tests do. The file itself is gitignored and rebuilt by `npm run kb:build`; see docs/integrator/knowledge-base.md. | `scripts/knowledge/lib.mjs:15` |

## Observability

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `LOG_FORMAT` | No | — | Access-log output format. | `server/logger.js:38`<br>`server/logger.js:39` |
| `LOG_LEVEL` | No | — | Server log verbosity. | `server/logger.js:27` |
| `ROHY_LOG_LEVEL` | No | `info` | Server log verbosity (Rohy-prefixed alias). | `server/logger.js:27`<br>`server/observability.js:17` |
| `ROHY_LOG_SKIP_PATHS` | No | — | Comma-separated request paths excluded from access logging. | `server/observability.js:46` |
| `ROHY_PATHOLOGY_CONTENT` | No | — | Path to a built slide content origin, overriding the sibling `../Pathoyon/dist-content` that `npm run starter-content` reads by default. Build-time only — nothing at runtime reads it. | `scripts/build-starter-content.mjs:227` |
| `ROHY_ROUTE_TIMEOUT_MS` | No | — | Per-route request timeout (ms). | `server/middleware/routeTimeout.js:38` |
| `ROHY_SHUTDOWN_GRACE_MS` | No | — | Graceful-shutdown drain window (ms). | `server/server.js:401` |
| `ROHY_SLOW_QUERY_MS` | No | — | Threshold (ms) above which a DB query is logged as slow. | `server/observability.js:22`<br>`server/observability.js:29` |
| `VERBOSE` | No | — | Extra console diagnostics when truthy. | `scripts/rocketbox-convert/convert.mjs:135` |

## Frontend/CORS

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `FRONTEND_URL` | No | — | Public frontend origin; drives CORS allow-list. _Recommended in production (validateEnv warns when unset)._ _Recommended in production (CORS rejects non-localhost origins when unset)._ | `server/server.js:77` |
| `ROHY_PLUGIN_IMPORT_ORIGINS` | No | — | Comma-separated `&lt;pluginId&gt;=&lt;origin&gt;` allowlist naming the hosts a plugin may DOWNLOAD from (RPS-1 1.4). The operator's outer bound: a tenant admin narrows it through the plugin's own settings and can never widen it, because a tenant admin is not the server operator and naming a host for rohy's server to fetch from is the SSRF shape proxy-routes.js already closed once. A plugin id may repeat and the origins accumulate. Unset means NO plugin may import from anywhere — the correct default for a server nobody has told where content may come from. Malformed is fatal at boot. | `server/lib/pluginImportOrigins.js:86` |
| `ROHY_PLUGIN_ORIGINS` | No | — | Comma-separated `&lt;pluginId&gt;=&lt;origin&gt;` allowlist naming where each RPS-1 plugin's remote content is fetched from, e.g. `pathology=https://slides.example.edu`. Unset means no plugin has a remote origin: the plugin serves the bundled starter content if any is installed, and otherwise every plugin proxy route answers 503. A malformed entry is fatal at boot — a typo must not degrade into rohy silently never contacting the host an operator believes it is using. The origin is operator configuration only: it is never read from a manifest, a case config or a request. | `server/lib/pluginRemoteOrigins.js:72` |

## LLM/TTS

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API credential (LLM). **⚠ secret — see security note above.** | `server/routes/proxy-routes.js:388` |
| `GOOGLE_API_KEY` | No | — | Google API credential. **⚠ secret — see security note above.** | `server/services/googleTts.js:127` |
| `GOOGLE_TTS_API_KEY` | No | — | Google Text-to-Speech API credential. **⚠ secret — see security note above.** | `server/routes/admin-routes.js:1719`<br>`server/routes/admin-routes.js:1744`<br>`server/routes/admin-routes.js:1745`<br>_+2 more_ |
| `OPENAI_API_KEY` | No | — | OpenAI API credential (LLM / TTS). **⚠ secret — see security note above.** | `server/routes/admin-routes.js:1746`<br>`server/routes/admin-routes.js:1747`<br>`server/routes/proxy-routes.js:394`<br>_+2 more_ |
| `PIPER_BIN` | No | — | Path to the Piper TTS binary. | `server/services/ttsProviders.js:35` |
| `ROHY_TEST_FAIL_GOOGLE_TTS` | No | — | _see source_ | `server/services/googleTts.js:164` |
| `ROHY_TEST_FAKE_GOOGLE_TTS` | No | — | Test hook: stub Google TTS instead of calling the API. | `server/services/googleTts.js:172` |
| `ROHY_TEST_FAKE_KOKORO_TTS` | No | — | _see source_ | `server/services/kokoroTts.js:244` |
| `ROHY_TEST_FAKE_OPENAI_TTS` | No | — | Test hook: stub OpenAI TTS instead of calling the API. | `server/services/openaiTts.js:74` |

## Oyon

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `OYON_ENABLED` | No | — | Mounts the Oyon emotion-capture addon as a live router (vs 503 stub). | `server/routes.js:39`<br>`server/routes/help-routes.js:129` |

## Retention

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `RETENTION_DAYS` | No | — | Data-retention window in days for the retention sweep. | `scripts/retention-sweep.js:42` |
| `RETENTION_SECONDS` | No | — | Data-retention window in seconds (overrides days when set). | `scripts/retention-sweep.js:40` |
| `ROHY_RETENTION_DAYS` | No | — | Data-retention window in days (Rohy-prefixed alias). | `scripts/retention-sweep.js:41` |
| `ROHY_RETENTION_SECONDS` | No | — | Data-retention window in seconds (Rohy-prefixed alias). | `scripts/retention-sweep.js:39` |

## Update/deploy

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ROHY_BACKUP_BEFORE_MIGRATE` | No | — | Toggles the pre-migration DB snapshot. | `server/db.js:521` |
| `ROHY_NO_AUTO_SEED` | No | — | Skips automatic seeders on boot. | `server/db.js:44` |

## Uncategorized

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ROHY_BASE_URL` | No | `http://localhost:3000` | _see source_ | `scripts/llm-language-smoke.mjs:26`<br>`scripts/translate-locales.mjs:34` |
| `ROHY_DISABLE_GENERAL_RATE_LIMIT` | No | — | _see source_ | `server/routes.js:92` |
| `ROHY_I18N_GLOSSARY` | No | — | _see source_ | `scripts/i18n/lib.mjs:310` |
| `ROHY_KOKORO_IDLE_UNLOAD_MIN` | No | `10` | Minutes without a synthesis before the Kokoro model is unloaded from RAM (frees ~380 MB on Linux; next voice reply reloads it). 0 = always resident + boot warmup. | `server/services/kokoroTts.js:72` |
| `ROHY_LANGS` | No | `'' (empty string)` | _see source_ | `scripts/llm-language-smoke.mjs:108` |
| `ROHY_LOCALES_ROOT` | No | — | _see source_ | `scripts/i18n/lib.mjs:61` |
| `ROHY_PACS_CONTENT` | No | — | Path to a built imaging content origin, overriding the sibling `../Radoyon/radoyon/dist-content` that `npm run starter-content` reads by default. Build-time only — nothing at runtime reads it. | `scripts/build-starter-content.mjs:226` |
| `ROHY_PASSWORD` | No | — | _see source_ **⚠ secret — see security note above.** | `scripts/llm-language-smoke.mjs:49` |
| `ROHY_PLUGIN_IMPORT_MAX_BYTES` | No | — | Deployment-wide ceiling, in bytes, on any plugin setting that binds to it (RPS-1 1.4, `ceilingEnv`) — today pathology's `imports.maxBytes`. A tenant admin may set a value BELOW this and can never set one above it, so an operator who caps a deployment is not overridden by a manifest declaring a larger max. Unset means the manifest's own max applies; an unparseable value is treated as unset rather than as zero, so a typo cannot silently forbid every legal value. | `server/routes/plugins-routes.js:530` |
| `ROHY_PLUGIN_LIBRARY_DIRS` | No | — | Comma-separated `&lt;pluginId&gt;=&lt;absolute path&gt;` map of the managed library directory each plugin's server module may write in (RPS-1 1.4). Plural, one per plugin, because a singular variable cannot serve a second plugin and "the second plugin needs no host edit" is the claim RPS-1 makes. Paths must be absolute: a relative path resolves against whatever working directory the service happens to have, which differs between a dev shell, a systemd unit and a Docker image. Unset means the plugin has no library and its import surface is unavailable — not an error. Malformed is fatal at boot. | `server/lib/pluginServerSlot.js:119` |
| `ROHY_PLUGIN_VIPS_CONCURRENCY` | No | — | How many threads an image tool (libvips) may use for a plugin conversion job. Defaults to half the machine's cores, minimum 1. libvips otherwise uses every core: measured on a 4-core server, one unbounded `dzsave` took 301% CPU for 21 seconds — three of four cores — starving the web server sharing the box, and its peak memory scales with thread count too, so an unbounded tool on a wide machine uses far more RAM than a capacity proof taken on a narrow one. Raise it on a dedicated conversion host. | `server/lib/pluginSpawn.js:63` |
| `ROHY_STARTER_CONTENT` | No | `'' (empty string)` | Set to `off` to refuse the starter content bundles rohy ships under `server/plugin-content/`. Those bundles are a licence-audited subset of the plugins' real content origins, served from disk when `ROHY_PLUGIN_ORIGINS` names no origin for a plugin, so that a fresh deployment finds imaging rather than an environment variable it cannot act on. A configured origin always wins over them. Turn them off where a deployment must show only its own material — a reading room in which an unrelated teaching image appears is a governance problem, not a convenience. | `server/routes/health-routes.js:225`<br>`server/routes/plugins-routes.js:218` |
| `ROHY_STARTER_CONTENT_DIR` | No | — | Where the starter content bundles live, overriding `server/plugin-content/`. The bundles are gigabytes, generated by `npm run setup:content` and not part of the source tree, so a container wants them on a mounted volume rather than baked into the image. Set this to the mount point. Unset uses the in-tree directory. | `server/routes/health-routes.js:222`<br>`server/routes/health-routes.js:223`<br>`server/routes/plugins-routes.js:207` |
| `ROHY_USERNAME` | No | — | _see source_ | `scripts/llm-language-smoke.mjs:48` |

---

_62 variables discovered. Generated by `scripts/docs-gen/gen-config.mjs` — regenerate with `npm run docs:gen:config`._
