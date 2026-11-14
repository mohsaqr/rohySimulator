# LAILA integration — the ~10-line drop-in

LAILA is a **Vite + React** client and a **Node/Express + Prisma** server. This
recipe wires Oyon capture → LAILA's DB → dashboards with almost no host code.
Nothing here is wired into LAILA; copy the snippets in.

## Client (Vite React) — `client.tsx`

```tsx
import { OyonCapture } from 'oyon/react/capture';

<OyonCapture
  apiBaseUrl="/api/oyon"
  getContext={() => ({ session_id: attempt.id, user_id: user.id, course_id: course.id })}
  getToken={() => token}
/>
```

## Server (Express + Prisma) — `server.ts`

```ts
import { createOyonExpressBatch } from 'oyon/server/express';

app.use(express.json({ limit: '4mb' }));
app.post(
  '/api/oyon/sessions/:sessionId/emotions/batch',
  createOyonExpressBatch({
    verifyToken: (h) => verifyToken(h),
    persist: ({ events, sessionId, auth }) =>
      prisma.oyonWindow.createMany({ skipDuplicates: true, data: events.map(toRow(sessionId, auth)) }),
  }),
);
```

## Schema (one-time) — `schema.prisma`

Append the `OyonWindow` model to LAILA's `schema.prisma`, then
`npx prisma migrate dev`. Additive — one new table, nothing existing is touched.

## Dashboards — one tag

```tsx
import 'oyon/app-element';
// …
<oyon-app chrome="capture-analytics" api-base-url="/api/oyon" />
```

## What Oyon owns vs. what you own

| Oyon handles | You provide |
|---|---|
| Capture, aggregation, window POST/retry | `apiBaseUrl` + identity (`getContext`) |
| Shape/size validation, session-pinning, response codes | `verifyToken` (your auth) |
| Batch contract + idempotency semantics | `persist` (your Prisma write) + the one-time schema |

Per Oyon's architecture boundary, Oyon never imports Prisma or LAILA code — the
DB write is always yours, so your data model stays yours.
