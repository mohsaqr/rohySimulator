import { createOyonBatchHandler } from './batchHandler.js';

/**
 * createOyonExpressBatch — Express request handler for Oyon window batches.
 *
 * The batteries-included server half for Express/Connect hosts (LAILA's server
 * is Node/Express + Prisma). Mount it in one line:
 *
 *   import express from 'express';
 *   import { createOyonExpressBatch } from 'oyon/server/express';
 *
 *   app.use(express.json({ limit: '4mb' }));   // windows carry per-sample raw_streams; a queued batch can be MBs
 *   app.post(
 *     '/api/oyon/sessions/:sessionId/emotions/batch',
 *     createOyonExpressBatch({
 *       verifyToken: (h) => auth.fromHeader(h),          // your auth
 *       persist: ({ events, sessionId, auth }) =>         // your Prisma write
 *         prisma.oyonWindow.createMany({ data: events.map(toRow(sessionId, auth)), skipDuplicates: true }),
 *     }),
 *   );
 *
 * Requires an upstream JSON body parser (`express.json()`), so `req.body` is the
 * parsed `{ events }` object. Everything else — auth, shape-check, session-pin,
 * response codes — is handled by the shared `createOyonBatchHandler` core.
 *
 * @param {object} options — same as `createOyonBatchHandler` (persist, verifyToken,
 *   maxBatchEvents, pinSessionId), plus:
 * @param {string} [options.sessionParam='sessionId'] the route param holding the
 *   session id (matches your `:sessionId` path segment).
 * @returns {(req: object, res: object) => Promise<void>} an async Express handler.
 */
export function createOyonExpressBatch(options = {}) {
  const { sessionParam = 'sessionId', ...handlerOptions } = options;
  const handle = createOyonBatchHandler(handlerOptions);

  return async function oyonExpressBatch(req, res) {
    const result = await handle({
      body: req?.body,
      sessionId: req?.params?.[sessionParam] ?? null,
      authorization: req?.headers?.authorization ?? null,
    });
    res.status(result.status).json(result.body);
  };
}
