import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, XCircle, Info } from 'lucide-react';
import { useNotifications } from '../notifications/useNotifications';
import { SOURCES, SEVERITY } from '../notifications/types';
import { ToastContextObject } from './ToastContextObject';

// Backwards-compat shim. The 243 existing `toast.success/error/warning/info`
// call sites and `toast.confirm(...)` keep working unchanged — they all flow
// through the central NotificationCenter now. This file no longer renders
// toasts itself; ToastSurface (mounted in App.jsx) does that.
//
// `confirm()` is the one piece that doesn't fit cleanly into a notification
// stream: it's a blocking modal that returns a Promise. We keep its UI here
// since it's its own thing (not really a notification, more a UX primitive).
//
// `useToast` lives in ./useToast.js so the hook implementation isn't tangled
// up with the provider component. We re-export it here for the 20+ existing
// callers that already do `import { useToast } from '../../contexts/ToastContext'`
// — same pattern used by AuthContext and VoiceContext in this repo.
// eslint-disable-next-line react-refresh/only-export-components
export { useToast } from './useToast';

export function ToastProvider({ children }) {
    const notifications = useNotifications();
    const [confirmDialog, setConfirmDialog] = useState(null);

    const toMs = (duration) => (duration === undefined ? undefined : duration);

    const success = useCallback((message, duration) => notifications.notify({
        source: SOURCES.USER, severity: SEVERITY.SUCCESS, message, ttlMs: toMs(duration),
    }), [notifications]);

    const error = useCallback((message, duration) => notifications.notify({
        source: SOURCES.SYSTEM, severity: SEVERITY.ERROR, message, ttlMs: toMs(duration),
    }), [notifications]);

    const warning = useCallback((message, duration) => notifications.notify({
        source: SOURCES.SYSTEM, severity: SEVERITY.WARNING, message, ttlMs: toMs(duration),
    }), [notifications]);

    const info = useCallback((message, duration) => notifications.notify({
        source: SOURCES.USER, severity: SEVERITY.INFO, message, ttlMs: toMs(duration),
    }), [notifications]);

    const remove = useCallback((id) => notifications.dismiss(id), [notifications]);

    const confirm = useCallback((message, options = {}) => {
        return new Promise((resolve) => {
            setConfirmDialog({
                message,
                title: options.title || 'Confirm',
                confirmText: options.confirmText || 'Confirm',
                cancelText: options.cancelText || 'Cancel',
                type: options.type || 'warning',
                onConfirm: () => { setConfirmDialog(null); resolve(true); },
                onCancel: () => { setConfirmDialog(null); resolve(false); },
            });
        });
    }, []);

    const toast = useMemo(() => ({ success, error, warning, info, remove, confirm }),
        [success, error, warning, info, remove, confirm]);

    return (
        <ToastContextObject.Provider value={toast}>
            {children}
            {confirmDialog && <ConfirmModal {...confirmDialog} />}
        </ToastContextObject.Provider>
    );
}

function ConfirmModal({ title, message, confirmText, cancelText, type, onConfirm, onCancel }) {
    const styles = {
        warning: { icon: AlertTriangle, iconBg: 'bg-yellow-900/50', iconColor: 'text-yellow-400', confirmBtn: 'bg-yellow-600 hover:bg-yellow-500' },
        danger: { icon: XCircle, iconBg: 'bg-red-900/50', iconColor: 'text-red-400', confirmBtn: 'bg-red-600 hover:bg-red-500' },
        info: { icon: Info, iconBg: 'bg-blue-900/50', iconColor: 'text-blue-400', confirmBtn: 'bg-blue-600 hover:bg-blue-500' },
    };
    const style = styles[type] || styles.warning;
    const Icon = style.icon;

    // Close on ESC.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onCancel} />
            <div className="relative bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl max-w-md w-full animate-in zoom-in-95 fade-in duration-200">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-full ${style.iconBg}`}>
                            <Icon className={`w-6 h-6 ${style.iconColor}`} />
                        </div>
                        <div className="flex-1 pt-1">
                            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
                            <p className="text-sm text-neutral-300 leading-relaxed">{message}</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-3 px-6 pb-6">
                    <button onClick={onCancel} className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg font-medium transition-colors">
                        {cancelText}
                    </button>
                    <button onClick={onConfirm} className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium transition-colors ${style.confirmBtn}`}>
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
