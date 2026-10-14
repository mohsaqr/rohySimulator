// Ending a session on the server: PUT /sessions/:id/end (idempotent there).
//
// It used to swallow a failure and resolve as if the end had happened, so the
// UI flipped to "ended" and opened the debrief for a session the server still
// had running — and the debrief tutor then refused, because it speaks only
// after the server has the end_time (FI-0010 review F10). Now the caller is
// told whether the server accepted it.
import { apiPut } from './apiClient';

/**
 * @param {number|string|null|undefined} sessionId
 * @returns {Promise<boolean>} true once the server has ended the session;
 *   false when there is no session or the request failed (the error is
 *   logged; the caller decides what the user sees)
 */
export async function endSessionOnServer(sessionId) {
    if (!sessionId) return false;
    try {
        await apiPut(`/sessions/${sessionId}/end`);
        return true;
    } catch (err) {
        console.error('[Session] Failed to end session on server:', err);
        return false;
    }
}
