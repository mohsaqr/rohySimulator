import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, User, Lock, AlertCircle, KeyRound, Eye, EyeOff } from 'lucide-react';

/**
 * The sign-in card. Pure card — the split-panel shell around it is AuthLayout,
 * owned by AuthGate.
 *
 * Every way into the platform is on this one card, policy-permitting:
 * password sign-in, "create an account" (open/approval), and "register with an
 * invitation code". The invite button is separate from the create-account link
 * because they are different promises: a code holder was told they have
 * something special, and a generic register link doesn't say "your code goes
 * here".
 */
export default function LoginPage({ onSwitchToRegister, onSwitchToInvite, policy }) {
    const { t } = useTranslation('auth');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    // In invite-only mode the plain "create an account" link is a lie — the
    // register form will demand a code anyway — so only the invite button shows.
    const inviteOnly = Boolean(policy?.invite_required);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(username, password);
        } catch (err) {
            setError(err.message || t('login_failed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-1">{t('welcome_back')}</h2>
            <p className="text-sm text-neutral-400 mb-6">{t('signin_continue')}</p>

            {error && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-200">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Username */}
                <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                        {t('username')}
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            disabled={loading}
                            placeholder={t('enter_username')}
                            autoComplete="username"
                            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                            required
                        />
                    </div>
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
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            placeholder={t('enter_password')}
                            autoComplete="current-password"
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

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {t('signing_in')}
                        </>
                    ) : (
                        <>
                            <LogIn className="w-5 h-5" />
                            {t('sign_in')}
                        </>
                    )}
                </button>
            </form>

            {/* The other ways in — or an explanation of their absence.
                `onSwitchToRegister` is null when the platform does not offer
                self-registration. Leaving a blank gap there reads as a broken
                page, and there is no "email us" fallback to lean on: the
                platform cannot send mail. So say plainly who to ask. */}
            <div className="mt-6 space-y-3">
                {onSwitchToRegister ? (
                    <>
                        {!inviteOnly && (
                            <p className="text-neutral-400 text-sm text-center">
                                {t('no_account_prompt')}{' '}
                                <button
                                    onClick={onSwitchToRegister}
                                    className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                                >
                                    {t('create_account')}
                                </button>
                            </p>
                        )}
                        {onSwitchToInvite && (
                            <button
                                type="button"
                                onClick={onSwitchToInvite}
                                className="w-full flex items-center justify-center gap-2 border border-neutral-700 hover:border-neutral-500 text-neutral-200 font-medium py-3 rounded-lg transition-colors"
                            >
                                <KeyRound className="w-4 h-4" />
                                {t('register_with_invite')}
                            </button>
                        )}
                    </>
                ) : (
                    <p className="text-neutral-500 text-sm text-center">
                        {policy?.message || t('registration_closed_hint')}
                    </p>
                )}
            </div>
        </div>
    );
}
