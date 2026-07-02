'use client';
//
// Host-neutral Oyon capture control for a Next.js (App Router) app such as
// LAILA. Drop this client component anywhere; it owns nothing about your
// backend except the base URL + token you give it.
//
// Why 'use client' + no SSR: the Oyon runtime touches `window`,
// `navigator.mediaDevices`, and `<canvas>`. It must never run during server
// render. Marking the component a client component is enough in the App
// Router; in the Pages Router, import it via `dynamic(() => ..., { ssr:false })`.
//
import { useOyon } from 'oyon/react';

/**
 * @param {object} props
 * @param {string} props.sessionId   — your lesson/attempt id (required)
 * @param {string} props.userId      — learner id
 * @param {string} [props.courseId]  — any extra keys ride along on every window
 * @param {() => string|null} [props.getToken] — bearer token for your API
 */
export default function OyonCapture({ sessionId, userId, courseId, getToken }) {
  const fer = useOyon({
    apiBaseUrl: '/api/oyon',            // points at the route handler below
    // Route batches to a clean RESTful path under apiBaseUrl. The matching
    // route handler lives at app/api/oyon/sessions/[sessionId]/emotions/batch/.
    transportOptions: {
      endpointForSession: (sessionId) => `/sessions/${sessionId}/emotions/batch`,
    },
    getToken,                           // omit for local-only (no backend)
    // Every key here lands on each aggregate window as a join key — keep your
    // own taxonomy (course_id, activity_id, cohort, …); nothing is dropped.
    getContext: () => ({
      session_id: sessionId,
      user_id: userId,
      course_id: courseId,
    }),
    onWindow: (windows) => {
      // Optional: also stream into your own telemetry; the windows already
      // POST to apiBaseUrl. Aggregate-only — never raw frames.
      console.debug('[oyon] window batch', windows.length);
    },
  });

  const running = fer.status === 'running' || fer.status === 'starting';

  return (
    <div>
      <button type="button" onClick={running ? fer.stop : fer.start}>
        {running ? 'Stop capture' : 'Start capture'}
      </button>
      <span style={{ marginLeft: 8 }}>status: {fer.status}</span>
      {fer.error ? (
        <p style={{ color: 'crimson' }}>
          {fer.error instanceof Error ? fer.error.message : String(fer.error)}
        </p>
      ) : null}
    </div>
  );
}
