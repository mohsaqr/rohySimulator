// A course's registration link, from both sides of the login (PRV-67).
//
// The teacher copies inviteLink(join_code) — the SAME /register?invite=CODE
// shape a registration invite uses, so there is one link format and one
// reader (AuthGate) for both. What differs is what happens on arrival:
//
//   * a new student registers with the code and the server enrols them;
//   * an existing student who signs in instead, or is already signed in,
//     joins the course with POST /cohorts/join (CourseLinkJoin).
//
// The sign-in path is the reason this module exists: AuthGate drops the code
// from the address bar the moment it reads it (it is a credential — Referer,
// screenshots, bookmarks), and AuthGate is unmounted the moment someone signs
// in. The code waits here, in memory only, for the signed-in app to pick it
// up. Not in localStorage/sessionStorage: it must not outlive the page load
// that brought it.
import { baseUrl } from '../config/api';

let pendingCourseCode = '';

/** The `invite` query parameter of the current URL, or ''. */
export function readInviteParam() {
    try {
        return new URLSearchParams(window.location.search).get('invite') || '';
    } catch {
        return '';
    }
}

/** Drop the code from the address bar (same target AuthGate uses). */
export function clearInviteParam() {
    try {
        window.history.replaceState({}, '', baseUrl('/') || '/');
    } catch { /* history is not load-bearing here */ }
}

/** Keep a course code for the signed-in app to redeem after a sign-in. */
export function rememberCourseCode(code) {
    pendingCourseCode = String(code || '');
}

/** Forget it — registration with the code already enrolled the person. */
export function forgetCourseCode() {
    pendingCourseCode = '';
}

/** Hand over the remembered code exactly once. */
export function takeCourseCode() {
    const code = pendingCourseCode;
    pendingCourseCode = '';
    return code;
}
