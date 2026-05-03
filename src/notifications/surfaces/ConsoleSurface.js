import { useEffect } from 'react';
import { useNotifications } from '../useNotifications';
import { SURFACES, SEVERITY } from '../types';

const COLOR = {
    [SEVERITY.DEBUG]: '\x1b[90m',
    [SEVERITY.INFO]: '\x1b[36m',
    [SEVERITY.SUCCESS]: '\x1b[32m',
    [SEVERITY.WARNING]: '\x1b[33m',
    [SEVERITY.ERROR]: '\x1b[31m',
    [SEVERITY.CRITICAL]: '\x1b[1;31m',
};
const RESET = '\x1b[0m';

// Dev/diagnostic surface. Only active when the routing layer keeps CONSOLE in
// the surface list — which respects prefs.consoleMuted. So the user can
// fully silence the console by flipping that pref, without code changes.
export default function ConsoleSurface() {
    const { subscribe } = useNotifications();
    useEffect(() => {
        const unsub = subscribe((evt) => {
            if (evt.type !== 'notify') return;
            const n = evt.notification;
            if (!n.routedSurfaces?.includes(SURFACES.CONSOLE)) return;
            const tag = `${COLOR[n.severity] || ''}[${n.source}/${n.severity}]${RESET}`;
            const label = n.title ? `${n.title}: ${n.message}` : n.message;
            console.log(tag, label, n.data || '');
        });
        return unsub;
    }, [subscribe]);
    return null;
}
