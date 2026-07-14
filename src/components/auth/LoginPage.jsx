import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES } from '../../i18n/languages';
import { LogIn, User, Lock, AlertCircle, Globe } from 'lucide-react';

export default function LoginPage({ onSwitchToRegister, policy }) {
    const { t } = useTranslation('auth');
    const { uiLanguage, setUiLanguage } = useLanguage();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

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
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Language selector — pre-login, persisted to localStorage so the
                    whole login/register flow renders in the chosen language. */}
                <div className="flex justify-end mb-4">
                    <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
                        <select
                            value={uiLanguage}
                            onChange={(e) => setUiLanguage(e.target.value)}
                            aria-label={t('language', { defaultValue: 'Language' })}
                            className="appearance-none bg-neutral-900 border border-neutral-800 rounded-lg pl-9 pr-8 py-2 text-sm text-neutral-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                        >
                            {Object.entries(LANGUAGES).map(([code, lang]) => (
                                <option key={code} value={code}>
                                    {lang.flag} {lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                {/* Logo/Header */}
            <div className="text-center mb-8">
                <h1 className="text-4xl font-bold text-white mb-2">Rohy</h1>
                <p className="text-neutral-400">{t('platform_tagline')}</p>
            </div>

                {/* Login Card */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl">
                    <div className="flex items-center gap-2 mb-6">
                        <LogIn className="w-6 h-6 text-blue-400" />
                        <h2 className="text-2xl font-bold text-white">{t('sign_in')}</h2>
                    </div>

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
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                    placeholder={t('enter_password')}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                                    required
                                />
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

                    {/* Register link — or an explanation of its absence.
                        `onSwitchToRegister` is null when the platform does not
                        offer self-registration. Leaving a blank gap there reads as
                        a broken page, and there is no "email us" fallback to lean
                        on: the platform cannot send mail. So say plainly who to ask. */}
                    <div className="mt-6 text-center">
                        {onSwitchToRegister ? (
                            <p className="text-neutral-400 text-sm">
                                {t('no_account_prompt')}{' '}
                                <button
                                    onClick={onSwitchToRegister}
                                    className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                                >
                                    {t('create_account')}
                                </button>
                            </p>
                        ) : (
                            <p className="text-neutral-500 text-sm">
                                {policy?.message || t('registration_closed_hint')}
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-6 text-center text-neutral-500 text-xs">
                    <p>{t('footer_tagline')}</p>
                </div>
            </div>
        </div>
    );
}
