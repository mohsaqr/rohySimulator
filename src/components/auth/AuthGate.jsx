import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import { getRegistrationPolicy, FAILSAFE_POLICY } from '../../services/registrationService';

/**
 * The logged-out surface: login, or register when the platform allows it.
 *
 * Mounted only from the `!user` branch, so the policy probe costs one request
 * for a logged-out visitor and nothing at all for everyone else.
 *
 * The probe decides only what we OFFER. The server decides what it ACCEPTS —
 * POST /auth/register re-reads the policy — so a stale or failed probe can never
 * let anyone in. That asymmetry is why we fail OPEN (see FAILSAFE_POLICY): the
 * downside of wrongly showing the register link is a clean 403; the downside of
 * wrongly hiding it is a fresh install with no path to its first admin.
 */
export default function AuthGate() {
    const { t } = useTranslation('auth');
    const [policy, setPolicy] = useState(null);
    const [showRegister, setShowRegister] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getRegistrationPolicy()
            .then((p) => { if (!cancelled) setPolicy(p); })
            .catch((err) => {
                // Not a user error — an older backend has no such route. Say so in
                // the console and carry on as open.
                console.warn('[auth] registration policy probe failed, assuming open:', err?.message);
                if (!cancelled) setPolicy(FAILSAFE_POLICY);
            });
        return () => { cancelled = true; };
    }, []);

    // Hold the whole card until we know. Flashing a login screen without the
    // register link and then popping it in reads as a bug.
    if (!policy) {
        return (
            <div className="flex items-center justify-center h-screen bg-neutral-950">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-neutral-400">{t('loading', 'Loading…')}</p>
                </div>
            </div>
        );
    }

    if (showRegister && policy.self_registration) {
        return <RegisterPage policy={policy} onSwitchToLogin={() => setShowRegister(false)} />;
    }

    return (
        <LoginPage
            policy={policy}
            onSwitchToRegister={policy.self_registration ? () => setShowRegister(true) : null}
        />
    );
}
