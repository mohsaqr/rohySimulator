// First-run gate — the app's second routing decision (after login itself).
// Sits between AuthenticatedApp's `user ?` branch and <MainApp/> so the
// setup surfaces render BEFORE the simulator mounts (loadDefaultCase must
// run after the user has picked their language, not before).
//
// Per role:
//   admin              → AdminSetupWizard until platform_settings.setup_completed
//                        (dismissible: both Finish and "Finish later" set the
//                        flag; the wizard stays reachable via useSetup()).
//   everyone else      → StudentFirstRun until user_preferences
//                        .onboarding_settings.first_run_done — server-side,
//                        so it follows the user across devices (deliberately
//                        NOT the localStorage pattern the OnboardingTour uses).
//
// Failure posture: any status/preferences fetch error logs and falls through
// to the app — a broken settings read must never lock everyone out.

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/apiClient';
import AdminSetupWizard from './AdminSetupWizard';
import StudentFirstRun, { FIRST_RUN_VERSION } from './StudentFirstRun';
import { parseOnboardingSettings } from '../../utils/onboardingSettings';

const SetupContext = createContext({ openSetupWizard: () => {} });

// Recall hook for the top-bar menu ("Platform setup", admin only).
export const useSetup = () => useContext(SetupContext);

export default function FirstRunGate({ children }) {
    const { user, isAdmin } = useAuth();
    // 'loading' | 'wizard' | 'first-run' | 'ready'
    const [phase, setPhase] = useState('loading');

    useEffect(() => {
        let cancelled = false;
        setPhase('loading');
        if (!user) return undefined;
        const probe = isAdmin()
            ? apiFetch('/setup/status').then(status => (status?.setup_completed ? 'ready' : 'wizard'))
            : apiFetch('/users/preferences').then(prefs => {
                const done = Number(parseOnboardingSettings(prefs).first_run_done) >= FIRST_RUN_VERSION;
                return done ? 'ready' : 'first-run';
            });
        probe
            .catch(err => {
                console.error('[FirstRunGate] status probe failed, skipping first-run:', err);
                return 'ready';
            })
            .then(next => { if (!cancelled) setPhase(next); });
        return () => { cancelled = true; };
        // isAdmin is stable per user; user?.id covers the switch.
    }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const openSetupWizard = useCallback(() => setPhase('wizard'), []);
    const contextValue = useMemo(() => ({ openSetupWizard }), [openSetupWizard]);

    if (phase === 'loading') {
        return (
            <div className="flex items-center justify-center h-screen bg-neutral-950">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (phase === 'wizard') {
        return <AdminSetupWizard onClose={() => setPhase('ready')} />;
    }

    if (phase === 'first-run') {
        return <StudentFirstRun onDone={() => setPhase('ready')} />;
    }

    return (
        <SetupContext.Provider value={contextValue}>
            {children}
        </SetupContext.Provider>
    );
}
