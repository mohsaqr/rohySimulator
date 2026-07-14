// Client API for the registration policy. Mirrors userService.js — thin wrappers
// over apiClient.
//
// Two audiences:
//   * getRegistrationPolicy() is PUBLIC (auth: false) and read by the logged-out
//     login screen to decide whether to offer "Create an account". It is a HINT,
//     never a control — POST /auth/register re-reads the policy server-side.
//   * get/saveRegistrationSettings() are the admin surface behind Platform → Users.
import { apiGet, apiPut } from './apiClient';

/** Public: what the login screen may offer. Never requires a token. */
export const getRegistrationPolicy = () =>
    apiGet('/auth/registration-policy', { auth: false });

/** Admin: read the stored policy. */
export const getRegistrationSettings = () => apiGet('/platform-settings/registration');

/** Admin: write the policy. `email_domains` may be an array or a comma string. */
export const saveRegistrationSettings = ({ mode, email_domains = [], message = '' }) =>
    apiPut('/platform-settings/registration', { mode, email_domains, message });

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
