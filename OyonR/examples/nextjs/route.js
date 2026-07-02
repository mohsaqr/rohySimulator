//
// Next.js App Router route handler for Oyon's window batches.
//
// Place at: app/api/oyon/sessions/[sessionId]/emotions/batch/route.js
// Contract: POST { events: [ <window payload>, ... ] }  →  200 { ok, inserted }
//
// This is the GENERIC backend contract — no Rohy/Express assumptions. The same
// shape works for any JS backend; only the persistence call changes.
//
import { validateEmotionBatch } from 'oyon/validation';

// Swap for your real DB/ORM (Prisma, Drizzle, Kysely, raw SQL…). Must be
// idempotent on (session_id, record_id): the client retries failed batches.
import { insertWindowsIdempotent } from '@/lib/oyonStore';
import { verifyToken } from '@/lib/auth';

export async function POST(req, { params }) {
  const { sessionId } = params;

  // 1. Auth — your platform's tokens. Reject early.
  const auth = await verifyToken(req.headers.get('authorization'));
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // 2. Parse + shape-validate. validateEmotionBatch mirrors the CLIENT
  //    deny-list (no frames/images/landmarks/raw points) — defense in depth.
  const body = await req.json().catch(() => null);
  const result = validateEmotionBatch(body, { maxBatchEvents: 64 });
  if (!result.ok) {
    return Response.json({ error: 'invalid_batch', details: result.errors }, { status: 400 });
  }

  // 3. Trust the validated session_id on the payload, but pin it to the route
  //    + the authenticated user so a token can't write another session.
  const events = body.events.filter((e) => e.session_id === sessionId);
  if (events.length !== body.events.length) {
    return Response.json({ error: 'session_mismatch' }, { status: 403 });
  }

  // 4. Idempotent insert — duplicates from retries must be free.
  const inserted = await insertWindowsIdempotent({
    tenantId: auth.tenantId ?? null,
    userId: auth.userId,
    sessionId,
    events,
  });

  return Response.json({ ok: true, inserted });
}
