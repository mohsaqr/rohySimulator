import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const [confirmDialog, setConfirmDialog] = useState(null);

    const addToast = useCallback((message, type = 'info', duration = 4000) => {
        const id = Date.now() + Math.random();
        const toast = { id, message, type, duration };

        setToasts(prev => [...prev, toast]);

        if (duration > 0) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }

        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Modern confirm dialog that returns a Promise
    const confirm = useCallback((message, options = {}) => {
        return new Promise((resolve) => {
            setConfirmDialog({
                message,
                title: options.title || 'Confirm',
                confirmText: options.confirmText || 'Confirm',
                cancelText: options.cancelText || 'Cancel',
                type: options.type || 'warning', // warning, danger, info
                onConfirm: () => {
                    setConfirmDialog(null);
                    resolve(true);
                },
                onCancel: () => {
                    setConfirmDialog(null);
                    resolve(false);
                }
            });
        });
    }, []);

    const toast = {
        success: (message, duration) => addToast(message, 'success', duration),
        error: (message, duration) => addToast(message, 'error', duration),
        warning: (message, duration) => addToast(message, 'warning', duration),
        info: (message, duration) => addToast(message, 'info', duration),
        remove: removeToast,
        confirm
    };

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
            {confirmDialog && <ConfirmModal {...confirmDialog} />}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

function ToastContainer({ toasts, onRemove }) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-md">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
}

function ToastItem({ toast, onRemove }) {
    const { id, message, type } = toast;

    const configs = {
        success: {
            icon: CheckCircle,
            bg: 'bg-green-900/95 border-green-600',
            iconColor: 'text-green-400',
            textColor: 'text-green-100'
        },
        error: {
            icon: XCircle,
            bg: 'bg-red-900/95 border-red-600',
            iconColor: 'text-red-400',
            textColor: 'text-red-100'
        },
        warning: {
            icon: AlertTriangle,
            bg: 'bg-yellow-900/95 border-yellow-600',
            iconColor: 'text-yellow-400',
            textColor: 'text-yellow-100'
        },
        info: {
            icon: Info,
            bg: 'bg-blue-900/95 border-blue-600',
            iconColor: 'text-blue-400',
            textColor: 'text-blue-100'
        }
    };

    const config = configs[type] || configs.info;
    const Icon = config.icon;

    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-xl backdrop-blur-sm animate-in slide-in-from-right-5 fade-in duration-300 ${config.bg}`}
        >
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.iconColor}`} />
            <p className={`text-sm flex-1 ${config.textColor}`}>{message}</p>
            <button
                onClick={() => onRemove(id)}
                className="text-neutral-400 hover:text-white p-1 -mr-1 -mt-1"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}

function ConfirmModal({ title, message, confirmText, cancelText, type, onConfirm, onCancel }) {
    const typeStyles = {
        warning: {
            icon: AlertTriangle,
            iconBg: 'bg-yellow-900/50',
            iconColor: 'text-yellow-400',
            confirmBtn: 'bg-yellow-600 hover:bg-yellow-500'
        },
        danger: {
            icon: XCircle,
            iconBg: 'bg-red-900/50',
            iconColor: 'text-red-400',
            confirmBtn: 'bg-red-600 hover:bg-red-500'
        },
        info: {
            icon: Info,
            iconBg: 'bg-blue-900/50',
            iconColor: 'text-blue-400',
            confirmBtn: 'bg-blue-600 hover:bg-blue-500'
        }
    };

    const style = typeStyles[type] || typeStyles.warning;
    const Icon = style.icon;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onCancel}
            />

            {/* Modal */}
            <div className="relative bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl max-w-md w-full animate-in zoom-in-95 fade-in duration-200">
                <div className="p-6">
                    {/* Icon and Title */}
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

                {/* Actions */}
                <div className="flex gap-3 px-6 pb-6">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg font-medium transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium transition-colors ${style.confirmBtn}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ToastContext;
