import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { UserPlus, User, Mail, Lock, AlertCircle, CheckCircle, KeyRound } from 'lucide-react';

export default function RegisterPage({ onSwitchToLogin, onRegistered, policy, invite, inviteToken }) {
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
    const { register } = useAuth();

    // An invite's own email rule beats the platform's list — an admin inviting an
    // external examiner to a single-domain instance meant to do that.
    const allowedDomains = invite?.valid && invite.email_domain
        ? [invite.email_domain]
        : (policy?.email_domains || []);
    const inviteRequired = Boolean(policy?.invite_required);
    const showInviteField = inviteRequired || Boolean(inviteToken) || Boolean(invite);
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

        if (formData.password.length < 6) {
            setError(t('password_too_short'));
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
            await register(formData.username, formData.email, formData.password, {
                invite: inviteCode || undefined,
            });
            onRegistered?.();
        } catch (err) {
            setError(err.message || t('registration_failed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo/Header */}
            <div className="text-center mb-8">
                <h1 className="text-4xl font-bold text-white mb-2">Rohy</h1>
                <p className="text-neutral-400">{t('platform_tagline')}</p>
            </div>

                {/* Register Card */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl">
                    <div className="flex items-center gap-2 mb-6">
                        <UserPlus className="w-6 h-6 text-blue-400" />
                        <h2 className="text-2xl font-bold text-white">{t('create_account')}</h2>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-200">
                            <AlertCircle className="w-5 h-5 shrink-0" />
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
                        {showInviteField && (
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
                                    type="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    disabled={loading}
                                    placeholder={t('create_password_placeholder')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
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
                                    type="password"
                                    name="confirmPassword"
                                    value={formData.confirmPassword}
                                    onChange={handleChange}
                                    disabled={loading}
                                    placeholder={t('reenter_password_placeholder')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password Requirements */}
                        <div className="text-xs text-neutral-500 space-y-1">
                            <div className="flex items-center gap-2">
                                <CheckCircle className={`w-3 h-3 ${formData.password.length >= 6 ? 'text-green-500' : 'text-neutral-700'}`} />
                                <span>{t('password_req_length')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <CheckCircle className={`w-3 h-3 ${formData.password === formData.confirmPassword && formData.password ? 'text-green-500' : 'text-neutral-700'}`} />
                                <span>{t('password_req_match')}</span>
                            </div>
                        </div>

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

                {/* Footer. Only true while the instance is unclaimed — this used to
                    be shown to everyone, promising admin to visitor number 400. */}
                {isClaimingInstance && (
                    <div className="mt-6 text-center text-neutral-500 text-xs">
                        <p>{t('first_user_admin_note')}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
