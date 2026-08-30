import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { UserPlus, User, Mail, Lock, AlertCircle, CheckCircle, Circle, KeyRound, MailCheck, Eye, EyeOff } from 'lucide-react';
import { PASSWORD_RULES, passwordMeetsRules } from '../../utils/passwordRules';

/**
 * Turn a registration failure into a sentence in the user's own language.
 *
 * Same story as translateLoginError() in LoginPage: AuthService.register()
 * throws `new Error(data.error)`, so the English server string was what every
 * non-English user saw, and `registration_failed` was translated five times
 * for nobody. The known shapes are fixed literals in
 * server/routes/auth-routes.js and INVITE_ERRORS in server/lib/invites.js.
 *
 * Every key is spelled out literally — `t(variable)` is invisible to the
 * i18n extractor. The `code` branch is checked first because the register
 * route already emits machine-readable codes, and it survives a future move
 * onto apiClient's ApiError (which preserves them).
 *
 * Admin-authored policy text (`policy.message` on a closed / invite-only
 * platform) is deliberately NOT matched: it was written by a human for this
 * platform, so it goes through as the detail of a translated frame.
 */
export function translateRegisterError(err, t) {
    const code = err?.code || err?.body?.code || '';
    const raw = typeof err?.message === 'string' ? err.message.trim() : '';

    if (code === 'invite_not_found' || raw === 'That invite code is not valid. Check it, or ask whoever sent it for a new one.') {
        return t('invite_invalid_not_found');
    }
    if (code === 'invite_revoked' || raw === 'That invite has been withdrawn. Ask whoever sent it for a new one.') {
        return t('invite_invalid_revoked');
    }
    if (code === 'invite_expired' || raw === 'That invite has expired. Ask whoever sent it for a new one.') {
        return t('invite_invalid_expired');
    }
    if (code === 'invite_exhausted' || raw === 'That invite has already been used the maximum number of times.') {
        return t('invite_invalid_exhausted');
    }

    // The two domain rules read the same to a user but name different lists,
    // and the list is the actionable part — pull it out and re-render it.
    const inviteDomain = /^This invite is limited to @(\S+) addresses\.$/.exec(raw);
    if (inviteDomain) return t('error_invite_email_domain', { domain: `@${inviteDomain[1]}` });
    const platformDomains = /^Registration is limited to these email domains: (.+)\.$/.exec(raw);
    if (platformDomains) return t('error_email_domain_not_allowed', { domains: platformDomains[1] });

    if (raw === 'Registration is closed. Ask an administrator to create your account.') {
        return t('error_registration_closed');
    }
    if (raw === 'You need an invite link or code to create an account here.') {
        return t('error_invite_required');
    }
    if (code === 'approval_already_requested' || raw === 'A request for this username or email is already waiting for approval.') {
        return t('error_approval_already_requested');
    }
    if (raw === 'Username or email already exists') return t('error_username_taken');
    if (raw === 'Username, email, and password are required') return t('error_signup_fields_required');
    // validatePassword() joins its complaints with '. ' — every one of them
    // starts here, and the checklist above already states the whole policy.
    if (raw.startsWith('Password must ')) return t('password_policy_unmet');
    if (/^Too many /i.test(raw)) return t('error_too_many_attempts');

    if (!raw || raw === 'Registration failed') return t('registration_failed');
    return t('registration_failed_detail', { detail: raw });
}

/**
 * One row of the live password checklist.
 *
 * Both states used to render the SAME filled tick and differ only by colour
 * (green vs grey), which is nothing at all to a colour-blind user and nothing
 * at all to a screen reader. So the shape changes too — a filled tick when the
 * rule is met, an empty ring when it is not — and the state is spelled out in
 * words for assistive tech. Colour is now the third channel, not the only one.
 */
function PasswordRequirement({ met, label, metLabel, unmetLabel }) {
    return (
        <li className="flex items-center gap-2" data-state={met ? 'met' : 'unmet'}>
            {met
                ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" aria-hidden="true" />
                : <Circle className="w-3 h-3 text-neutral-600 shrink-0" aria-hidden="true" />}
            <span className={met ? 'text-green-400' : undefined}>{label}</span>
            <span className="sr-only">{met ? metLabel : unmetLabel}</span>
        </li>
    );
}

export default function RegisterPage({ onSwitchToLogin, onRegistered, policy, invite, inviteToken, startWithCode = false }) {
    const { t } = useTranslation('auth');
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        confirmPassword: ''
    });
    // Prefilled and locked when we arrived on a WORKING invite link; empty and
    // editable when the link was bad, so the user can paste a fresh code rather
    // than being stuck staring at a dead one.
    const [inviteCode, setInviteCode] = useState(invite?.valid ? inviteToken : '');
    const [codeLocked, setCodeLocked] = useState(Boolean(invite?.valid));
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // Same affordance the sign-in card has. A password you cannot read is a
    // password you mistype twice, and "passwords do not match" with both
    // fields masked tells you nothing about which one is wrong.
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    // approval mode: the request is queued and there is no account yet.
    const [submitted, setSubmitted] = useState(false);
    const { register } = useAuth();

    // An invite's own email rule beats the platform's list — an admin inviting an
    // external examiner to a single-domain instance meant to do that.
    const allowedDomains = invite?.valid && invite.email_domain
        ? [invite.email_domain]
        : (policy?.email_domains || []);
    const inviteRequired = Boolean(policy?.invite_required);
    // An invite is one artifact with two deliveries: a link, and a code you can
    // read down the phone. The code has to be enterable in EVERY mode that lets
    // you register — an invite still carries a role and a course when the
    // platform is open, so a recipient with no box to type it into would sign up
    // as a plain student and the invite would silently go unused.
    //
    // But an always-open code box is noise for the 95% who were just told "go
    // sign up", so it starts collapsed behind a one-line prompt, and expands on
    // its own whenever a code is actually in play (link arrival, or invite-only).
    const [codeOpen, setCodeOpen] = useState(
        startWithCode || inviteRequired || Boolean(inviteToken) || Boolean(invite)
    );
    // True only while the users table is genuinely empty. The old footer claimed
    // "the first user becomes an administrator" unconditionally, which was a lie
    // to every visitor after the first one.
    const isClaimingInstance = Boolean(policy?.bootstrap);

    const handleChange = (e) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    const validateForm = () => {
        if (formData.username.length < 3) {
            setError(t('username_too_short'));
            return false;
        }

        if (!formData.email.includes('@')) {
            setError(t('email_invalid'));
            return false;
        }

        if (!passwordMeetsRules(formData.password)) {
            setError(t('password_policy_unmet'));
            return false;
        }

        if (formData.password !== formData.confirmPassword) {
            setError(t('passwords_do_not_match'));
            return false;
        }

        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!validateForm()) {
            return;
        }

        setLoading(true);

        try {
            const data = await register(formData.username, formData.email, formData.password, {
                invite: inviteCode || undefined,
            });
            // approval mode answers 202 with no user and no token: the account does
            // not exist yet. Say so and stop — calling onRegistered() here would
            // hand back to an app that has nobody logged in, which reads as the
            // signup having silently failed.
            if (data?.code === 'approval_pending') {
                setSubmitted(true);
                return;
            }
            onRegistered?.();
        } catch (err) {
            setError(translateRegisterError(err, t));
        } finally {
            setLoading(false);
        }
    };

    // The request is in the queue. There is nothing more for them to do here, so
    // don't leave a form on screen inviting them to do it again.
    if (submitted) {
        return (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl text-center">
                <div className="w-12 h-12 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
                    <MailCheck className="w-6 h-6 text-blue-300" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">{t('approval_pending_title')}</h2>
                <p className="text-neutral-400 text-sm mb-6">{t('approval_pending_body')}</p>
                <button
                    type="button"
                    onClick={onSwitchToLogin}
                    className="text-blue-400 hover:text-blue-300 font-medium text-sm transition-colors"
                >
                    {t('back_to_signin')}
                </button>
            </div>
        );
    }

    // Pure card — the split-panel shell around it is AuthLayout, owned by AuthGate.
    return (
        <div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl">
                    <div className="flex items-center gap-2 mb-6">
                        <UserPlus className="w-6 h-6 text-blue-400" />
                        <h2 className="text-2xl font-bold text-white">{t('create_account')}</h2>
                    </div>

                    {error && (
                        <div
                            role="alert"
                            aria-live="assertive"
                            className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-200"
                        >
                            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span className="text-sm">{error}</span>
                        </div>
                    )}

                    {/* You arrived on a working invite link: say what it gets you,
                        BEFORE the form. Someone who was sent a link wants to know
                        they're in the right place. */}
                    {invite?.valid && (
                        <div className="mb-4 p-3 bg-emerald-900/30 border border-emerald-500/50 rounded-lg flex items-start gap-2 text-emerald-100">
                            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <span className="text-sm">
                                {invite.cohort_name
                                    ? t('invite_valid_with_course', { course: invite.cohort_name })
                                    : t('invite_valid')}
                            </span>
                        </div>
                    )}

                    {/* The link was real but is no longer usable. Don't strand
                        them: the code field below is cleared and editable so they
                        can paste a fresh one. */}
                    {invite && !invite.valid && (
                        <div className="mb-4 p-3 bg-amber-900/30 border border-amber-500/50 rounded-lg flex items-start gap-2 text-amber-100">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <span className="text-sm">{t(`invite_invalid_${invite.reason}`, t('invite_invalid_not_found'))}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Invite code — first, because it determines what the rest
                            of this form even gets you (role, course). */}
                        {!codeOpen && (
                            <button
                                type="button"
                                onClick={() => setCodeOpen(true)}
                                className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                            >
                                <KeyRound className="w-4 h-4" />
                                {t('invite_have_code')}
                            </button>
                        )}

                        {codeOpen && (
                            <div>
                                <label className="block text-sm font-medium text-neutral-300 mb-2">
                                    {t('invite_code')}
                                </label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                                    <input
                                        type="text"
                                        name="invite"
                                        value={inviteCode}
                                        onChange={(e) => setInviteCode(e.target.value)}
                                        disabled={loading || codeLocked}
                                        autoComplete="off"
                                        placeholder={t('invite_code_placeholder')}
                                        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-60"
                                        required={inviteRequired}
                                    />
                                </div>
                                {codeLocked && (
                                    <button
                                        type="button"
                                        onClick={() => { setCodeLocked(false); setInviteCode(''); }}
                                        className="mt-1.5 text-xs text-blue-400 hover:text-blue-300"
                                    >
                                        {t('invite_use_different_code')}
                                    </button>
                                )}
                                {/* Say it is optional, or an open-mode signup who
                                    opened this box out of curiosity will think they
                                    are now required to produce a code they don't have. */}
                                {!inviteRequired && !codeLocked && (
                                    <p className="mt-1.5 text-xs text-neutral-500">{t('invite_code_optional')}</p>
                                )}
                            </div>
                        )}

                        {/* Username */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                {t('username')}
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                                <input
                                    type="text"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    disabled={loading}
                                    autoComplete="username"
                                    placeholder={t('choose_username')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
                            </div>
                        </div>

                        {/* Email */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                {t('email')}
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    disabled={loading}
                                    autoComplete="email"
                                    placeholder={t('email_placeholder')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
                            </div>
                            {/* Tell them the rule BEFORE they submit — the server
                                enforces it either way, but finding out on submit is
                                a needless round trip. */}
                            {allowedDomains.length > 0 && (
                                <p className="mt-1.5 text-xs text-neutral-500">
                                    {t('email_domain_hint', {
                                        domains: allowedDomains.map((d) => `@${d}`).join(', '),
                                    })}
                                </p>
                            )}
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                {t('password')}
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    disabled={loading}
                                    autoComplete="new-password"
                                    placeholder={t('create_password_placeholder')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-12 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? t('hide_password') : t('show_password')}
                                    tabIndex={-1}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Confirm Password */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                {t('confirm_password')}
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                                <input
                                    type={showConfirm ? 'text' : 'password'}
                                    name="confirmPassword"
                                    value={formData.confirmPassword}
                                    onChange={handleChange}
                                    disabled={loading}
                                    autoComplete="new-password"
                                    placeholder={t('reenter_password_placeholder')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-12 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm((v) => !v)}
                                    aria-label={showConfirm ? t('hide_password') : t('show_password')}
                                    tabIndex={-1}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors"
                                >
                                    {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Password requirements — the LIVE mirror of the server's
                            validatePassword(). One row per rule, ticking as you
                            type, so nobody meets the policy for the first time as
                            a 400 after submit. */}
                        <ul className="text-xs text-neutral-500 grid grid-cols-2 gap-x-4 gap-y-1 list-none p-0 m-0">
                            {PASSWORD_RULES.map(({ key, test }) => (
                                <PasswordRequirement
                                    key={key}
                                    met={test(formData.password)}
                                    label={t(`password_req_${key}`)}
                                    metLabel={t('password_req_met')}
                                    unmetLabel={t('password_req_unmet')}
                                />
                            ))}
                            <PasswordRequirement
                                met={Boolean(formData.password) && formData.password === formData.confirmPassword}
                                label={t('password_req_match')}
                                metLabel={t('password_req_met')}
                                unmetLabel={t('password_req_unmet')}
                            />
                        </ul>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    {t('creating_account')}
                                </>
                            ) : (
                                <>
                                    <UserPlus className="w-5 h-5" />
                                    {t('create_account')}
                                </>
                            )}
                        </button>
                    </form>

                    {/* Login Link */}
                    <div className="mt-6 text-center">
                        <p className="text-neutral-400 text-sm">
                            {t('have_account_prompt')}{' '}
                            <button
                                onClick={onSwitchToLogin}
                                className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                            >
                                {t('sign_in')}
                            </button>
                        </p>
                    </div>
                </div>

                {/* Only true while the instance is unclaimed — this used to be
                    shown to everyone, promising admin to visitor number 400. */}
                {isClaimingInstance && (
                    <div className="mt-6 text-center text-neutral-500 text-xs">
                        <p>{t('first_user_admin_note')}</p>
                    </div>
                )}
        </div>
    );
}
