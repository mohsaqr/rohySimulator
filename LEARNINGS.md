# Project Learnings

### 2026-02-18
- [sqlite3]: Project uses `sqlite3` (async callback API), not `better-sqlite3`. Use `db.all(sql, params, callback)` and `db.run()` patterns. Cannot use `better-sqlite3` in inline node scripts.
- [database seeding]: To insert test data for multiple users, must use SQLite directly via `node --input-type=module` with the `sqlite3` import, since the POST `/api/learning-events` endpoint assigns `user_id` from the JWT token (always the logged-in user).
- [verb merging]: The `eventLogger.js` defines 50+ xAPI verbs. For TNA analysis, these are merged server-side into 10 clinical labels: NAVIGATION, ORDERED_LAB, VIEWED_LAB_RESULT, TREATMENT, EXAMINATION, SENT_MESSAGE, RECEIVED_MESSAGE, MONITORING, ALARM_RESPONSE, REVIEWED_RECORDS. System/config verbs (STARTED_SESSION, CHANGED_SETTING, etc.) are excluded (mapped to null).
- [ConfigPanel structure]: ConfigPanel.jsx is ~4860 lines. Sidebar tabs are inside an `isAdmin()` conditional block ending around line 313. Tab content is rendered conditionally before line ~855. The `Activity` icon is already imported from lucide-react.
- [routes.js size]: `server/routes.js` is ~7600 lines. The `export default router;` line is at the very end. New endpoints should be inserted before it.
- [env setup]: Server requires `server/.env` with `JWT_SECRET`. Without it, server exits immediately with FATAL error. Copy from `server/.env.example` and generate a key.
- [vite proxy]: Vite dev server proxies `/api` to `http://localhost:3000`. API calls through the frontend go through this proxy, not directly to port 3000.
- [TNA computation]: TNA model computed client-side in `useMemo` keyed on `[data, pruneThreshold]`. Avoids refetching when only prune threshold changes. The computation (transition matrix + initial probability vector) is fast even for hundreds of sequences.
- [SVG rendering]: Used polygon arrows instead of SVG `<marker>` elements — markers don't scale per-edge and are hard to style. Bidirectional edges must be curved (Bezier) or they overlap. Self-loops rendered as circular arcs outside nodes pointing away from graph center.
- [rare verb filtering]: Verbs below the `min_verb_pct` threshold (default 5%) are replaced with "OTHER", then consecutive duplicates collapsed. This prevents graph noise from infrequent actions.
