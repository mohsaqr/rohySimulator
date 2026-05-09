# Oyon Platform Design

Oyon is a standalone facial-expression capture and analytics system. A host
application such as Rohy supplies identity, auth, policy, and storage endpoints;
Oyon owns capture, settings, logging, aggregate measurements, and analytics
contracts.

## Boundaries

Oyon owns:

- camera and model runtime lifecycle,
- versioned settings profiles,
- consent/capture/session metadata,
- aggregate emotion windows,
- runtime logs and metrics,
- analytics/dynamical features,
- standalone browser storage and export contracts.

Host apps provide:

- `tenant_id`, `user_id`, `session_id`, `case_id`,
- auth token provider,
- feature/policy flags,
- optional HTTP endpoints for persistence,
- optional dashboard embedding.

## Data Streams

Oyon separates data by purpose:

| Stream | Purpose | Default |
|---|---|---|
| `oyon_emotion_windows` | Learning analytics source of truth | on |
| `oyon_runtime_events` | Operational logs | on |
| `oyon_metrics` | Numeric operations measurements | on |
| `oyon_dynamics` | Derived DynaJ/dashboard features | on |
| per-sample model logs | high-resolution research/debug | off |

Raw frames, images, video, audio, landmarks, pixels, blobs, and base64 media are
outside the data contract.

## Settings

Settings live in `src/settings/OyonSettings.js` and are versioned with
`oyon-settings-v1`. Every persisted window should include a settings snapshot
or `settings_hash` so later dashboards know how data was sampled.

The default profile is low-frequency learning analytics:

```js
sample_interval_ms: 1000
aggregate_window_ms: 10000
min_valid_frames: 6
smoothing_alpha: 0.28
min_hold_ms: 3000
switch_confidence: 0.5
```

## Persistence

Standalone Oyon can use `IndexedDbOyonStore`, which mirrors the host schema:

```text
captures
emotion_windows
runtime_events
metrics
settings_profiles
consents
dynamics
```

Server hosts can use the SQL templates in:

```text
examples/sql/sqlite/001_oyon_core.sql
examples/sql/postgres/001_oyon_core.sql
```

The older Rohy-specific `examples/rohy-backend/` files remain adapter templates,
not the canonical platform schema.

## Analytics

`src/analytics/DynamicalFeatures.js` computes DynaJ-ready features from
aggregate windows:

- valence/arousal velocity,
- valence/arousal acceleration,
- affect speed,
- affect volatility,
- confidence and entropy trends,
- missingness trend,
- valence/arousal phase quadrant,
- dominant-label transitions,
- instability score.

These are derived features. Aggregate windows remain the source of truth.

## Host Adapter Contract

A generic host should only adapt context and endpoints:

```js
createOyonAttachment({
  host: 'rohy',
  getContext: () => ({
    tenant_id,
    user_id,
    session_id,
    case_id,
  }),
  getToken,
  endpoints: {
    windows: '/api/oyon/windows',
    logs: '/api/oyon/logs',
    metrics: '/api/oyon/metrics',
    consents: '/api/oyon/consents',
    settings: '/api/oyon/settings',
  },
  policy: {
    allowCapture: true,
    allowSampleLogs: false,
    allowDashboard: true,
  },
});
```

Rohy should remain one adapter over this generic contract.
