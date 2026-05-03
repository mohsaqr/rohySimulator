import { createContext } from 'react';

// React context object for the toast/confirm primitive. Lives in its own
// module so ToastContext.jsx can satisfy `react-refresh/only-export-components`.
export const ToastContextObject = createContext(null);
