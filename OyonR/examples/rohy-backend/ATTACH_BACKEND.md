# Backend Attachment Template

These files are intentionally not copied into Rohy yet:

- `0011_emotion_windows.sql`
- `emotion-routes.template.js`

When source edits are allowed, attach them like this:

1. Copy `0011_emotion_windows.sql` into `migrations/`.
2. Copy `emotion-routes.template.js` into `server/routes/emotion-routes.js`.
3. Import `validateEmotionBatch` from `oyon/validation` if Oyon is workspace-linked, or adjust the import path for your host layout.
4. Mount the route from `server/routes.js` with the same auth/helper dependencies used by existing route modules.
5. Add purge/anonymization handling for Oyon aggregate rows.
6. Add tests for:
   - valid batch insert,
   - raw image rejection,
   - cross-user session rejection,
   - cross-tenant rejection,
   - timestamp outside session rejection,
   - read permissions.

This backend stores only aggregate windows. It must reject raw frames, images, video, pixel arrays, and landmarks.
