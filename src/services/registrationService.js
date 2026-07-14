// Client API for the registration policy and invites. Mirrors userService.js —
// thin wrappers over apiClient.
//
// Three audiences:
//   * getRegistrationPolicy() / previewInvite() are PUBLIC (auth: false) and read
//     by the logged-out auth screens. They are HINTS, never controls — POST
//     /auth/register re-reads the policy and re-checks the invite server-side.
//   * get/saveRegistrationSettings() are the admin surface behind Platform → Users.
//   * the invite CRUD is the admin surface behind Users → Invites.
import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';
import { baseUrl } from '../config/api';

/** Public: what the login screen may offer. Never requires a token. */
export const getRegistrationPolicy = () =>
    apiGet('/auth/registration-policy', { auth: false });

/** Admin: read the stored policy. */
export const getRegistrationSettings = () => apiGet('/platform-settings/registration');

/** Admin: write the policy. `email_domains` may be an array or a comma string. */
export const saveRegistrationSettings = ({ mode, email_domains = [], message = '' }) =>
    apiPut('/platform-settings/registration', { mode, email_domains, message });

// --- Invites ----------------------------------------------------------------

/** Public: what someone arriving on an invite link should be told. */
export const previewInvite = (token) =>
    apiGet(`/auth/invite/${encodeURIComponent(token)}`, { auth: false });

export const listInvites = () => apiGet('/registration-invites');
export const createInvite = (payload) => apiPost('/registration-invites', payload);
export const revokeInvite = (id) => apiDelete(`/registration-invites/${id}`);
export const listInviteUses = (id) => apiGet(`/registration-invites/${id}/uses`);

/**
 * The shareable link for an invite.
 *
 * Built through baseUrl() rather than by hand: in production Vite sets
 * `base: '/rohy/'`, so a hardcoded `${origin}/register?...` produces a link that
 * 404s for every person you send it to — and you would only find out from the
 * people who could not get in. One implementation, shared by the UI and its tests.
 */
export const inviteLink = (token) =>
    `${window.location.origin}${baseUrl('/register')}?invite=${encodeURIComponent(token)}`;

/** Group a token for display: ABCD-EFGH-JKLM. Purely cosmetic — the server
 *  normalises whatever comes back, so a user may type it either way. */
export const formatInviteCode = (token) =>
    String(token || '').replace(/(.{4})(?=.)/g, '$1-');

/**
 * The shape the UI falls back to when the probe cannot be reached.
 *
 * FAIL OPEN, deliberately. The security cost is zero — the server is the real
 * gate and still refuses a registration the policy forbids — while failing
 * CLOSED would be catastrophic: a probe failure against an older backend (which
 * has no such route) would hide the register link on a fresh install, and
 * self-registration is the ONLY path to a first admin there (production refuses
 * to seed default users). We would brick the install to protect a hint.
 */
export const FAILSAFE_POLICY = {
    mode: 'open',
    self_registration: true,
    invite_required: false,
    approval_required: false,
    email_domains: [],
    message: null,
    bootstrap: false,
};
