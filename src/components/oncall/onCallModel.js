// Pure helpers for the on-call phone. Kept out of the component files so
// they are unit-testable and so the .jsx files export components only
// (react-refresh/only-export-components).
//
// Which agent types are specialists is NOT decided here: the registry in
// server/shared/specialties.js is the single source of truth.

import { isSpecialistType, specialtyTypeForRoom } from '../../../server/shared/specialties.js';
import { AgentService } from '../../services/AgentService';

/** The case's enabled on-call specialists, in the server's order. */
export function specialistsOf(agents) {
    if (!Array.isArray(agents)) return [];
    return agents.filter(a => a && a.enabled !== false && isSpecialistType(a.agent_type));
}

// Honorifics and the "On-call" title are dropped before taking initials, so
// "Dr. Samira Haddad" reads "SH" and "On-call Pathologist" reads "PA", not
// "OP" (every seeded specialist would otherwise read "O…").
const HONORIFIC = /^(dr|doctor|prof|professor|mr|mrs|ms|miss|on-call|oncall)\.?$/i;

/**
 * Up to two uppercase initials from a display name; '?' when there is none.
 * A single remaining word gives its first two letters.
 */
export function initialsOf(name) {
    const words = String(name || '').trim().split(/\s+/)
        .filter(w => w && !HONORIFIC.test(w) && !/^on$/i.test(w) && !/^call$/i.test(w));
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return [words[0], words[words.length - 1]].map(w => w[0].toUpperCase()).join('');
}

// Seeded specialists carry .glb 3D avatars, which cannot be drawn in a
// contact row. Only a plain 2D image URL is shown; everything else gets the
// initials disc.
export function isImageAvatar(url) {
    return typeof url === 'string' && /^(https?:\/\/|\/)[^\s]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url);
}

// oncall-namespace keys for the specialty tag. Static so i18next-parser sees
// them; the render site calls t() on the looked-up key.
export const SPECIALTY_LABEL_KEYS = Object.freeze({
    pathologist: 'specialty_pathologist',
    cardiologist: 'specialty_cardiologist',
    radiologist: 'specialty_radiologist',
    laboratorian: 'specialty_laboratorian',
});

/**
 * How the phone can reach a specialist right now.
 *   'available'  — present: message or call straight away
 *   'on_call'    — must be paged first (the phone pages on first contact)
 *   'paging'     — paged, on the way (arrives_at in the future)
 *   'unavailable'— disabled, departed, not yet on shift
 *   'no_answer'  — on the phone, but the case switched every room this
 *                  specialist owns off (config.rooms): the call rings and
 *                  nobody picks up. The server sets `answers: false` and
 *                  refuses paging and conversations with 409 no_answer.
 */
export function reachabilityOf(agent, elapsedMinutes = 0) {
    if (!agent) return 'unavailable';
    if (agent.answers === false) return 'no_answer';
    const display = AgentService.getAgentDisplayStatus(agent, elapsedMinutes);
    if (display.canChat) return 'available';
    if (display.canPage) return 'on_call';
    if (display.status === 'paged') return 'paging';
    return 'unavailable';
}

/** Specialists the learner can contact (now, by paging, or once they arrive). */
export function countReachable(agents, elapsedMinutes = 0) {
    return specialistsOf(agents)
        .filter(a => !['unavailable', 'no_answer'].includes(reachabilityOf(a, elapsedMinutes))).length;
}

/** How long a call to a specialist who will not answer rings before "No answer". */
export const NO_ANSWER_RING_MS = 6000;

/** A call id the conversation route accepts: [A-Za-z0-9_-], at most 64 chars. */
export function newCallId() {
    const raw = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/** mm:ss for a call timer. */
export function formatCallDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// AgentService.sendAgentMessage never throws: it returns these English
// prefixes on failure. They are shown in the thread but never read aloud.
export function isFailedReply(text) {
    return typeof text === 'string' && /^(Error:|Rate limit exceeded:|Service unavailable:)/.test(text);
}

/**
 * The oncall-namespace key for a one-line reachability label: "Available",
 * "On call", "Paging…" / "Paging… 0:42", "No answer",
 * "Not available".
 */
export function statusKeyFor(state, hasRemaining = false) {
    if (state === 'available') return 'status_available';
    if (state === 'on_call') return 'status_on_call';
    if (state === 'paging') return hasRemaining ? 'status_paging_eta' : 'status_paging';
    if (state === 'no_answer') return 'status_no_answer';
    return 'status_unavailable';
}

/**
 * The specialist who owns a room, so the phone opens on the right person:
 * the pathology room reaches the pathologist, PACS and the legacy radiology
 * room the radiologist, the ECG room the cardiologist, the lab room the
 * laboratory specialist. A room nobody owns (patient chat, exam, debrief)
 * opens the contact list.
 *
 * A thin re-export of the registry's own mapping: the same list answers
 * `requireRoomActivity` on the server, and two copies of "which room belongs
 * to whom" would drift the moment a specialty gained a room.
 *
 * @param {string|null} room  currentRoom (a core room key or a plugin id)
 * @returns {string|null}     agent_type, or null
 */
export function specialistTypeForRoom(room) {
    return specialtyTypeForRoom(room);
}
