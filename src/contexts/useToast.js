import { useContext } from 'react';
import { ToastContextObject } from './ToastContextObject';

// Backwards-compatible hook. Lives in its own module so ToastContext.jsx can
// be a "components only" file (lint rule react-refresh/only-export-components).
export function useToast() {
    const context = useContext(ToastContextObject);
    if (!context) throw new Error('useToast must be used within a ToastProvider');
    return context;
}
