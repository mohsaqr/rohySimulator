import { createContext } from 'react';

// The React context object lives in its own module so the Provider component
// file can satisfy `react-refresh/only-export-components` (no non-component
// exports next to a component definition).
export const NotificationContextObject = createContext(null);
