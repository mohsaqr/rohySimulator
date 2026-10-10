// Whether case packages (CasePackages.jsx) are switched on for this server.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/apiClient';

/**
 * Fired on window by the Platform switch after a save, so a case list already
 * on screen shows or hides its package buttons at once instead of on the
 * next visit to Settings. `detail` is the saved settings.
 */
export const CASE_PACKAGES_CHANGED = 'rohy:case-packages-changed';

/** Whether case packages are on — admin-only route; anyone else sees "off". */
export default function useCasePackages(enabledForRole) {
    const [settings, setSettings] = useState(null);
    useEffect(() => {
        if (!enabledForRole) return undefined;
        let cancelled = false;
        apiFetch('/platform-settings/case-packages')
            .then((data) => { if (!cancelled) setSettings(data); })
            .catch(() => { if (!cancelled) setSettings({ enabled: false }); });
        const onChange = (event) => { if (!cancelled) setSettings(event.detail); };
        window.addEventListener(CASE_PACKAGES_CHANGED, onChange);
        return () => {
            cancelled = true;
            window.removeEventListener(CASE_PACKAGES_CHANGED, onChange);
        };
    }, [enabledForRole]);
    return Boolean(enabledForRole && settings?.enabled);
}
