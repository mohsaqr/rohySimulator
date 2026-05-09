# Attachment Decision

## Recommended Shape

Keep FER as a sidecar package, not as a deep Rohy feature.

Rohy should import exactly one attachment factory:

```js
createRohyFerAttachment(...)
```

The attachment receives context through callbacks. It should not import Rohy services, contexts, React components, or database code.

## Why This Boundary

- FER can be disabled by removing one mount.
- FER can be reused in other simulation apps.
- FER can be tested without Rohy.
- Rohy retains control over consent, auth, and analytics policy.
- The FER module can evolve its MediaPipe/ONNX internals without changing Rohy session code.

## Anti-Coupling Rules

- FER module must not import from `src/contexts`, `src/services/apiClient`, or Rohy components.
- FER module must not read `localStorage` directly except through caller-provided `getToken`.
- FER module must not decide who can view analytics.
- FER module must not store raw frames.
- FER module must not mutate Rohy session state.
- Rohy adapter must be less than one screen of code.

## Future Package Layout

When ready, move this folder to one of:

- `packages/fer-module`
- a separate repository,
- a private npm package.

Then Rohy can consume it as:

```json
{
  "dependencies": {
    "oyon": "workspace:*"
  }
}
```

or as a published package.
