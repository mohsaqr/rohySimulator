import { apiUrl } from '../config/api';

// Notes are per-(session, user). The server scopes by req.user.id from the
// auth token, so the client just needs to send the session id and the text.

function authHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchSessionNote(sessionId) {
    const res = await fetch(apiUrl(`/sessions/${sessionId}/discussion-notes`), {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`fetchSessionNote ${res.status}`);
    return res.json(); // { note_text, updated_at }
}

export async function saveSessionNote(sessionId, noteText) {
    const res = await fetch(apiUrl(`/sessions/${sessionId}/discussion-notes`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ note_text: noteText }),
    });
    if (!res.ok) throw new Error(`saveSessionNote ${res.status}`);
    return res.json();
}
