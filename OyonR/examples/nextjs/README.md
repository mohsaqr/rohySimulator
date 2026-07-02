# Oyon in a Next.js app (host-neutral)

A complete, framework-correct recipe for adding Oyon to a Next.js host such as
**LAILA** — no Rohy assumptions. Two files:

| File | Goes at | Role |
|---|---|---|
| [`OyonCapture.jsx`](OyonCapture.jsx) | any client component path | Capture control via the host-neutral `useOyon` hook |
| [`route.js`](route.js) | `app/api/oyon/sessions/[sessionId]/emotions/batch/route.js` | Batch-ingest endpoint using `oyon/validation` |

## The two rules that make Next.js work

1. **Never server-render the runtime.** Oyon touches `window` /
   `navigator.mediaDevices` / `<canvas>`. `OyonCapture.jsx` is a
   `'use client'` component — that's sufficient in the App Router. In the
   Pages Router, import it with `dynamic(() => import('./OyonCapture'), { ssr: false })`.
2. **Camera needs a secure context + a user gesture.** Serve over HTTPS (or
   `localhost`); `start()` runs from the button click. Add
   `Permissions-Policy: camera=(self)` and, if Oyon renders in an iframe,
   `allow="camera"`. CSP must include `'wasm-unsafe-eval'`. See
   [`../../docs/COMPATIBILITY.md`](../../docs/COMPATIBILITY.md).

## Use it

```jsx
// app/lesson/[id]/page.jsx  (server component is fine)
import OyonCapture from '@/components/OyonCapture';

export default function Lesson({ params }) {
  return <OyonCapture sessionId={params.id} userId={currentUser.id} courseId="bio-101" />;
}
```

`getContext` keeps **your** taxonomy — `course_id`, `activity_id`, `cohort`,
anything — on every aggregate window. That's the difference from the
Rohy-shaped `useRohyFer`, which drops everything but its fixed four fields.

## Where the data goes

- **Local-only:** omit `apiBaseUrl`/`getToken` from `OyonCapture.jsx`. Windows
  persist in the browser; consume them via the `onWindow` callback. No backend.
- **Your DB (shown here):** the route handler validates each batch with
  `validateEmotionBatch`, pins `session_id` to the route + token, and inserts
  idempotently. Schema to start from:
  [`../rohy-addon/001_oyon_addon.sql`](../rohy-addon/001_oyon_addon.sql)
  (or the Postgres translation in
  [`../../docs/INTEGRATION_MANUAL.md`](../../docs/INTEGRATION_MANUAL.md) §8.2).

Replace the `@/lib/oyonStore` and `@/lib/auth` imports in `route.js` with your
real persistence + token verification. Everything else is contract-complete.
