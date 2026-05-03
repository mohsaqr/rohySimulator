import { useContext } from 'react';
import { NotificationContextObject } from './NotificationContextObject';

export function useNotifications() {
    const ctx = useContext(NotificationContextObject);
    if (!ctx) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return ctx;
}
