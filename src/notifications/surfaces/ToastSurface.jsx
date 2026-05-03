import React, { useMemo } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useNotifications } from '../useNotifications';
import { SURFACES, SEVERITY } from '../types';

const STYLES = {
    [SEVERITY.SUCCESS]: { icon: CheckCircle, bg: 'bg-green-900/95 border-green-600', iconColor: 'text-green-400', textColor: 'text-green-100' },
    [SEVERITY.ERROR]: { icon: XCircle, bg: 'bg-red-900/95 border-red-600', iconColor: 'text-red-400', textColor: 'text-red-100' },
    [SEVERITY.CRITICAL]: { icon: XCircle, bg: 'bg-red-900/95 border-red-500', iconColor: 'text-red-300', textColor: 'text-red-50' },
    [SEVERITY.WARNING]: { icon: AlertTriangle, bg: 'bg-yellow-900/95 border-yellow-600', iconColor: 'text-yellow-400', textColor: 'text-yellow-100' },
    [SEVERITY.INFO]: { icon: Info, bg: 'bg-blue-900/95 border-blue-600', iconColor: 'text-blue-400', textColor: 'text-blue-100' },
    [SEVERITY.DEBUG]: { icon: Info, bg: 'bg-neutral-800/95 border-neutral-700', iconColor: 'text-neutral-400', textColor: 'text-neutral-200' },
};

export default function ToastSurface() {
    const { active, dismiss, pause, resume, prefs } = useNotifications();

    const visible = useMemo(() => {
        return active
            .filter(n => Array.isArray(n.routedSurfaces) && n.routedSurfaces.includes(SURFACES.TOAST))
            .slice(-prefs.toastMaxVisible);
    }, [active, prefs.toastMaxVisible]);

    if (visible.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-md">
            {visible.map(n => (
                <ToastCard
                    key={n.id}
                    n={n}
                    onDismiss={() => dismiss(n.id)}
                    onPause={() => pause(n.id)}
                    onResume={() => resume(n.id)}
                />
            ))}
        </div>
    );
}

// Hover-anywhere on the toast pauses its auto-expiry; mouse-leave resumes
// with a fresh full TTL window. Focus / blur (keyboard nav) are also
// honoured so a tab-through user can read the message without it timing
// out under their cursor. Click-anywhere dismisses (in addition to the
// X button) — bigger hit target.
function ToastCard({ n, onDismiss, onPause, onResume }) {
    const style = STYLES[n.severity] || STYLES[SEVERITY.INFO];
    const Icon = style.icon;
    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-xl backdrop-blur-sm animate-in slide-in-from-right-5 fade-in duration-300 cursor-pointer ${style.bg} ${n.paused ? 'ring-2 ring-white/20' : ''}`}
            onMouseEnter={onPause}
            onMouseLeave={onResume}
            onFocus={onPause}
            onBlur={onResume}
            onClick={(e) => { if (e.target.closest('button')) return; onDismiss(); }}
            tabIndex={0}
            role="status"
            aria-live="polite"
        >
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.iconColor}`} />
            <div className="flex-1">
                {n.title && <p className={`text-sm font-bold mb-0.5 ${style.textColor}`}>{n.title}</p>}
                <p className={`text-sm ${style.textColor}`}>
                    {n.message}
                    {n.count > 1 && <span className="ml-2 px-1.5 py-0.5 rounded bg-black/30 text-xs">×{n.count}</span>}
                </p>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="text-neutral-400 hover:text-white p-1 -mr-1 -mt-1"
                aria-label="Dismiss"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
