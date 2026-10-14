// "End & Debrief": end the session on the server, and only then commit the
// ended state (`onEnded`). A failed end leaves the case running and says so —
// through the notification center, plus `failed` for the confirm dialog to
// offer a retry — instead of opening a debrief the server would refuse.
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotifications } from '../notifications/useNotifications';
import { SOURCES, SEVERITY } from '../notifications/types';
import { endSessionOnServer } from '../services/sessionEnd';

/**
 * @param {{sessionId: number|null, onEnded: () => void}} params
 * @returns {{ending: boolean, failed: boolean, endSession: () => Promise<boolean>, reset: () => void}}
 */
export function useEndSession({ sessionId, onEnded }) {
    const { t } = useTranslation('app');
    const { notify } = useNotifications();
    const [ending, setEnding] = useState(false);
    const [failed, setFailed] = useState(false);
    // A ref, not the state: a double click lands before the re-render.
    const inFlight = useRef(false);

    const endSession = useCallback(async () => {
        if (!sessionId || inFlight.current) return false;
        inFlight.current = true;
        setEnding(true);
        const ok = await endSessionOnServer(sessionId);
        inFlight.current = false;
        setEnding(false);
        if (!ok) {
            setFailed(true);
            notify({
                source: SOURCES.SYSTEM,
                severity: SEVERITY.ERROR,
                key: 'end-session-failed',
                message: t('end_session_failed'),
            });
            return false;
        }
        setFailed(false);
        onEnded();
        return true;
    }, [sessionId, onEnded, notify, t]);

    const reset = useCallback(() => setFailed(false), []);

    return { ending, failed, endSession, reset };
}
