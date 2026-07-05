# Platform technologies and operations

Rohy's platform layer is the engineering foundation that makes the clinical simulation usable in real institutions. It connects the React application, Node and Express backend, SQLite persistence, provider routing, Oyon browser inference, deployment tooling, migration policy, observability, security and data lifecycle. These are not background details. They determine whether the simulator can be trusted, maintained, audited and studied.

The platform is designed for self-hosted clinical-education settings. A site may run in local development, on a classroom machine, under systemd, in Docker, from a published image or in an air-gapped environment. The architecture therefore favours explicit configuration, local-first options, controlled updates and strong operational evidence over hidden managed-service assumptions.

## Frontend and runtime architecture

The frontend is a React and Vite application organised around workspaces. The learner sees the simulation runtime: patient, rooms, monitor, voice and debrief. Educators see authoring, courses and analytics. Administrators see users, settings, logs and platform configuration. The same application therefore has to support immersive simulation and enterprise administration without confusing the two.

Three.js and React Three Fiber support the avatar layer. GLB heads, morph targets and lipsync connect voice playback to visual patient behaviour. Browser speech input can support voice mode. Client services coordinate voice requests, event logging, runtime state and analytics calls. The frontend is not just a view layer; it is where simulation state, learner interaction and multimodal presentation meet.

## Backend routing and middleware

The backend is a Node and Express application. Bootstrap configures process-level concerns such as CORS, headers, warmup and route mounting. Product behaviour lives in route groups: auth, users, tenants, cases, sessions, orders, analytics, notifications, agents, cohorts, admin routes and Oyon add-on routes. This separation matters because a growing platform needs clear seams. New endpoints should belong to an area router, not be hidden in process bootstrap.

Cross-cutting middleware carries the institutional guarantees. Authentication resolves the user. Role middleware enforces rank. Tenant middleware enforces organisational boundaries. Request IDs support log correlation. Redaction protects sensitive response fields. Error handling centralises final response shape. The result is a backend that treats security and observability as infrastructure rather than optional handler code.

## Persistence, snapshots and migrations

Rohy currently uses SQLite because the target deployment is a self-hosted, single-instance application. SQLite is simple, durable and appropriate for a classroom or institutional host where one application instance owns the database. The platform still includes portability helpers so future database evolution is not blocked by careless SQL patterns.

Persistence stores users, tenants, courses, cases, scenarios, case versions, session snapshots, orders, reports, exam findings, learning events, Oyon aggregate records, audit logs, export records and platform settings. Session snapshots are one of the most important invariants. When a learner starts a case, the relevant authored state is frozen for that session. Later edits do not alter the live run. This protects debrief, analytics and research reproducibility.

Migrations are versioned and checksum-tracked. The migration manifest classifies changes as additive, destructive or unknown. Additive migrations can be applied normally. Destructive migrations require explicit operator acknowledgement. Unknown migrations fail closed. This policy exists because rollback safety is a product requirement. A schema change is not just a developer concern; it affects whether an institution can recover from a bad update.

## AI, voice and avatar providers

Rohy uses server-side provider routing for LLM and TTS calls. The client does not send trusted API keys. Patient, agent and discussant model settings are resolved on the server through platform and persona configuration. Usage and cost can be recorded centrally. This allows different personas to use different models while preserving governance over secrets, budgets and provider behaviour.

The TTS stack supports local and cloud options. Kokoro and Piper support local voice generation. OpenAI and Google support cloud TTS. Runtime voice requests use the active provider, while admin preview can audition providers without changing runtime settings. Streaming PCM support allows the client to start playback before an entire response is complete, which is important for voice-mode realism.

The avatar layer depends on stable morph-target and viseme conventions. This is why the embedding kit documents its invariants. If a head asset does not match the expected morph targets, lipsync degrades silently. In Rohy, voice, avatar and model routing are therefore part of the same product surface: the learner experiences them as one patient or agent.

## Oyon as a browser-side add-on

Oyon is integrated as a vendored add-on mounted under Rohy's API. Its core technical decision is browser-side inference. Camera capture, face tracking and expression inference run in the user's browser through MediaPipe and ONNX Runtime Web. The browser aggregates windows and sends only aggregate data to the server. Raw frames and landmarks do not leave the device, and server validation rejects raw-media fields.

This architecture serves both privacy and research. It allows Rohy to study aggregate affect and gaze patterns without turning the server into a video store. Consent, tenant enablement, per-tenant retention and role-keyed visibility are part of the product model. When Oyon is disabled or fails to import, the API returns a structured stub rather than a bare 404, so the frontend and operator can present an understandable state.

## Deployment and updates

Rohy supports multiple deployment paths because institutions differ. A developer may run Vite and Express locally. A classroom may use a single-machine install. A production site may use systemd behind nginx or Docker behind Caddy. A restricted environment may use an air-gapped bundle. Published images support reproducible deploys when a tagged artifact exists.

Production deployment has a few non-negotiable ideas. The Node port should sit behind a reverse proxy and TLS. `JWT_SECRET` must be strong and present. `FRONTEND_URL` must match the public origin for CORS. Default seeded users should not remain active in production. Oyon models must be present if Oyon is enabled. The SPA base path must match the reverse proxy path, especially when serving under `/rohy`.

Updates are operator-driven. The update tooling is built around backup before mutation, migration dry-run, controlled apply, post-deploy verification and rollback where safe. The design accepts ordinary maintenance downtime but does not accept silent half-upgrades. Destructive migration gates, rollback recipes and backup snapshots reflect that priority.

## Observability, audit and verification

Rohy emits NDJSON logs with request IDs, levels and event-specific fields. Slow-query warnings include sanitized SQL summaries so operators can investigate latency without leaking row data. Access logging can skip sensitive prompt-bearing paths. Oyon exposes health and rejection counters. System audit logs, export records and usage logs create governance evidence.

Deploy verification matters because a server that starts is not necessarily healthy. The verifier can check health endpoints, the SPA shell, bundled assets, Oyon mount behaviour, auth gating, security headers, response timing and, when armed, Oyon validation contracts. This turns deployment from hope into evidence.

## Security, redaction and data lifecycle

Rohy's security model combines JWT authentication, server-side active-session revocation, live user refresh on every request, rank-based RBAC, tenant middleware, CSRF checks for cookie-authenticated state-changing requests, central redaction and audit logging. A valid token cannot outrank the current user row. A force logout or account change can take effect on the next request. Tenant mismatch should not leak resource existence.

Redaction is centralised in `server/redaction.js`. Secrets, token hashes, API keys, JSON settings, PII and internal fields must be handled by policy rather than ad hoc deletion in routes. This makes privacy review possible. If a new sensitive field is added, the correct response is to register it in the central policy, not to hope every handler remembers to remove it.

Retention and purge complete the lifecycle. Time-bounded logs can be swept according to configured windows, and Oyon has per-tenant retention. User purge is a separate account-level governance action. These controls matter because Rohy produces educational and research data that should not accumulate indefinitely without policy.

## Platform tradeoffs

Rohy makes explicit tradeoffs. SQLite keeps deployment simple but is not a multi-writer fleet database. Operator-driven updates preserve institutional control but do not provide surprise automatic upgrades. Browser-side Oyon protects the raw-media boundary but requires browser support and consent. Local LLM and TTS support improves privacy and resilience but may require model setup. Central redaction improves auditability but requires discipline when new fields are added. Path-prefix deployment supports hubs but requires build and proxy alignment.

These choices are coherent for the target setting: self-hosted clinical education, simulation research, institutional governance and local operational control. The platform layer is scientifically important because it protects the validity of the data. If identity is unstable, tenant scope leaks, cases mutate mid-session, exports lack provenance or raw sensor data crosses the wrong boundary, the research trace is compromised. Operations are therefore part of Rohy's scientific apparatus, not merely plumbing.

Related guides include [Architecture seams](/integrator/architecture), [Adding a TTS / LLM provider](/integrator/providers), [Embedding the avatar kit](/integrator/embedding), [Installing Rohy](/operator/install), [Deploying Rohy to production](/operator/deploy), [Migrations runbook](/operator/migrations), [Update strategy](/operator/update-strategy), [Observability](/operator/observability), [Hardening checklist](/security/hardening), [RBAC and auth model](/security/rbac), [Redaction and PII](/security/redaction), [Oyon and EU AI Act](/security/oyon-ai-act), and [Retention and purges](/operator/retention).
