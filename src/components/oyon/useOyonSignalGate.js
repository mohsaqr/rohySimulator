// Resolves whether host-driven signal capture may run, and under what config.
//
// Three independent conditions, deliberately kept separate from
// `useSignalCapture` so the capture hook stays a pure lifecycle:
//   1. the tenant runs Oyon and enabled at least one signal modality;
//   2. the learner consented, to a contract that COVERS the signal scope
//      (v1 was camera-only — see utils/oyonConsent.js);
//   3. a consent row exists for this session, because the server gates ingest
//      on the row, not on the client's opinion.
//
// (3) is why this hook exists at all rather than a couple of booleans in
// App.jsx: signal capture must not inherit the camera widget's consent POST,
// or typing analytics would silently produce nothing whenever the camera is
// off. `ensureSessionConsent` is shared and posts at most once per session.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/apiClient';
import { parseOnboardingSettings } from '../../utils/onboardingSettings';
import { OYON_CONSENT_CHANGED_EVENT, coveredRuntime } from '../../utils/oyonConsent';
import { ensureSessionConsent } from './ensureSessionConsent';
import { anyModalityEnabled } from './useSignalCapture';

/**
 * @returns {{ enabled: boolean, persist: boolean, runtimeConfig: object|null }}
 * `enabled` gates construction; `persist` additionally requires the consent
 * row, so a failed consent POST reads as "do not send", never as "fine".
 */
export function useOyonSignalGate(sessionId) {
    const [config, setConfig] = useState(null);   // { enabled, consent_version, runtime }
    // What the learner accepted, or null when they have not said yes. Kept as
    // the version, not a boolean, because coverage is decided per modality.
    const [acceptedVersion, setAcceptedVersion] = useState(null);
    // The session the consent row is confirmed for — not a bare boolean, so a
    // session change invalidates it by comparison rather than by a
    // synchronous reset inside the effect (which would cascade a render).
    const [rowReadyFor, setRowReadyFor] = useState(null);
    // Bumped when a consent surface saves a new choice, so the read below runs
    // again. Reading once at mount left capture off for the rest of the page
    // after a learner accepted the consent prompt (Prova PRV-5).
    const [consentRevision, setConsentRevision] = useState(0);

    useEffect(() => {
        const onChange = () => setConsentRevision((n) => n + 1);
        window.addEventListener(OYON_CONSENT_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(OYON_CONSENT_CHANGED_EVENT, onChange);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [cfg, prefs] = await Promise.all([
                    apiFetch('/addons/oyon/config'),
                    apiFetch('/users/preferences'),
                ]);
                if (cancelled) return;
                setConfig(cfg || null);
                const onboarding = parseOnboardingSettings(prefs);
                // Coverage is per modality (see coveredRuntime), so record WHAT
                // was accepted. A learner on v1 consented to camera affect only,
                // and coveredRuntime switches every signal modality off for them.
                setAcceptedVersion(
                    onboarding.oyon_consent === true
                        ? (onboarding.oyon_consent_version || 'oyon-consent-v1')
                        : null,
                );
            } catch {
                // Offline, gated off, or preferences unavailable — stay closed.
            }
        })();
        return () => { cancelled = true; };
    }, [consentRevision]);

    const runtimeConfig = acceptedVersion ? coveredRuntime(config?.runtime || null, acceptedVersion) : null;
    const enabled = Boolean(config?.enabled) && anyModalityEnabled(runtimeConfig);

    useEffect(() => {
        if (!enabled || !sessionId) return undefined;
        let cancelled = false;
        ensureSessionConsent(sessionId).then(ok => {
            if (!cancelled && ok) setRowReadyFor(sessionId);
        });
        return () => { cancelled = true; };
    }, [enabled, sessionId]);

    // A failed consent POST leaves rowReadyFor unset, so persist stays false —
    // the failure reads as "do not send", never as "fine".
    return { enabled, persist: enabled && rowReadyFor === sessionId, runtimeConfig };
}
