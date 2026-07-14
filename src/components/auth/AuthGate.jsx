import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AuthLayout from './AuthLayout';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import {
    getRegistrationPolicy,
    previewInvite,
    FAILSAFE_POLICY,
} from '../../services/registrationService';
import { baseUrl } from '../../config/api';

/**
 * The logged-out surface: login, or register when the platform allows it.
 *
 * Mounted only from the `!user` branch, so the policy probe costs one request
 * for a logged-out visitor and nothing at all for everyone else.
 *
 * The probe decides only what we OFFER. The server decides what it ACCEPTS —
 * POST /auth/register re-reads the policy and re-checks the invite — so a stale
 * or failed probe can never let anyone in. That asymmetry is why we fail OPEN
 * (see FAILSAFE_POLICY): the downside of wrongly showing the register link is a
 * clean 403; the downside of wrongly hiding it is a fresh install with no path
 * to its first admin.
 */
export default function AuthGate() {
    const { t } = useTranslation('auth');

    // Read the invite from the QUERY STRING, not the pathname. That way both
    // /register?invite=X and /?invite=X work, so the feature survives a proxy
    // that doesn't route /register to the app shell.
    const [inviteToken] = useState(() => {
        try {
            return new URLSearchParams(window.location.search).get('invite') || '';
        } catch {
            return '';
        }
    });

    const [policy, setPolicy] = useState(null);
    const [invite, setInvite] = useState(null);          // {valid, role, cohort_name, …}
    const [invitePending, setInvitePending] = useState(Boolean(inviteToken));
    const [showRegister, setShowRegister] = useState(Boolean(inviteToken));
    // "Register with an invitation code" on the login card: same register form,
    // but with the code field already open — the holder of a code must never
    // have to hunt for where it goes.
    const [startWithCode, setStartWithCode] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getRegistrationPolicy()
            .then((p) => { if (!cancelled) setPolicy(p); })
            .catch((err) => {
                // Not a user error — an older backend has no such route. Note it
                // in the console and carry on as open.
                console.warn('[auth] registration policy probe failed, assuming open:', err?.message);
                if (!cancelled) setPolicy(FAILSAFE_POLICY);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!inviteToken) return undefined;
        let cancelled = false;
        previewInvite(inviteToken)
            .then((res) => { if (!cancelled) setInvite(res); })
            .catch(() => { if (!cancelled) setInvite({ valid: false, reason: 'not_found' }); })
            .finally(() => { if (!cancelled) setInvitePending(false); });
        return () => { cancelled = true; };
    }, [inviteToken]);

    // Drop the token from the address bar once we have read it. It is a
    // credential; it should not sit in the URL to be screenshotted, bookmarked
    // or pasted into a bug report.
    const clearInviteFromUrl = () => {
        try {
            window.history.replaceState({}, '', baseUrl('/') || '/');
        } catch { /* history is not load-bearing here */ }
    };

    // Hold the CARD until we know — but show the brand panel immediately, so
    // the wait reads as the product loading, not a blank screen. Flashing a
    // login card without the register link and then popping it in reads as a bug.
    if (!policy || invitePending) {
        return (
            <AuthLayout>
                <div className="text-center py-16">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-neutral-400">{t('loading')}</p>
                </div>
            </AuthLayout>
        );
    }

    // A VALID invite outranks a closed platform — that is what an invite IS: a
    // named exception, issued by an admin, to the rule on the front door.
    const canRegister = policy.self_registration || invite?.valid;

    if (showRegister && canRegister) {
        return (
            <AuthLayout>
                <RegisterPage
                    policy={policy}
                    invite={invite}
                    inviteToken={inviteToken}
                    startWithCode={startWithCode}
                    onRegistered={clearInviteFromUrl}
                    onSwitchToLogin={() => {
                        setShowRegister(false);
                        setStartWithCode(false);
                        clearInviteFromUrl();
                    }}
                />
            </AuthLayout>
        );
    }

    return (
        <AuthLayout>
            <LoginPage
                policy={policy}
                onSwitchToRegister={canRegister ? () => setShowRegister(true) : null}
                onSwitchToInvite={canRegister ? () => { setStartWithCode(true); setShowRegister(true); } : null}
            />
        </AuthLayout>
    );
}
