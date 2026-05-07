import { apiFetch, apiPut } from './apiClient.js';

// Notes are per-(session, user). The server scopes by req.user.id from the
// auth token, so the client just needs to send the session id and the text.

export async function fetchSessionNote(sessionId) {
    return apiFetch(`/sessions/${sessionId}/discussion-notes`);
}

export async function saveSessionNote(sessionId, noteText) {
    return apiPut(`/sessions/${sessionId}/discussion-notes`, { note_text: noteText });
}
