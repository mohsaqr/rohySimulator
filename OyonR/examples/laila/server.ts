// LAILA server (Node/Express + Prisma) — the entire server-side integration.
// Mount one route; supply your auth + a Prisma write. Everything else
// (shape-check, session-pin, response codes, idempotency contract) is Oyon's.
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createOyonExpressBatch } from 'oyon/server/express';
import { verifyToken } from '../auth'; // your existing LAILA auth

const prisma = new PrismaClient();
const app = express();
app.use(express.json({ limit: '4mb' })); // windows carry per-sample raw_streams

app.post(
  '/api/oyon/sessions/:sessionId/emotions/batch',
  createOyonExpressBatch({
    verifyToken: (header) => verifyToken(header), // -> { userId, tenantId? } | null
    // Idempotent on (sessionId, record_id): the client retries failed batches,
    // so skipDuplicates keeps retries free. `events` is already validated +
    // pinned to the route's sessionId.
    persist: ({ events, sessionId, auth }) =>
      prisma.oyonWindow.createMany({
        skipDuplicates: true,
        data: events.map((e: Record<string, unknown>) => ({
          sessionId: sessionId as string,
          recordId: String(e.record_id ?? `${e.window_start}`),
          userId: (auth as { userId?: string })?.userId ?? (e.user_id as string) ?? null,
          courseId: (e.course_id as string) ?? null,
          windowStart: new Date(e.window_start as string),
          windowEnd: new Date(e.window_end as string),
          payload: e, // full window as JSON — research-grade: keep everything
        })),
      }),
  }),
);
