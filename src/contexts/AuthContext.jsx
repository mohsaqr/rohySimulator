import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthService } from '../services/authService';
import { apiPost } from '../services/apiClient';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is already logged in on mount
        const verifyUser = async () => {
            try {
                const userData = await AuthService.verifyToken();
                setUser(userData);
            } catch (error) {
                console.error('Token verification failed:', error);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };

        verifyUser();
    }, []);

    // Periodic JWT refresh. The server-issued token has a 4h TTL; we
    // refresh every 3h so an active user never sees a forced logout.
    // The /auth/refresh endpoint rotates the active_sessions row, so
    // server-side revocation (logout, admin force-logout, password
    // change) still applies — the next refresh against a revoked
    // session simply 401s and we drop the user state.
    useEffect(() => {
        if (!user) return;
        const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3h
        const tick = async () => {
            const result = await AuthService.refreshToken();
            if (!result) {
                // Refresh failed — most likely the session was revoked.
                // Log the user out client-side; they'll re-login or
                // verifyToken() on next mount will catch the dead session.
                AuthService.logout();
                setUser(null);
            }
        };
        const id = setInterval(tick, REFRESH_INTERVAL_MS);
        return () => clearInterval(id);
    }, [user]);

    const login = async (username, password) => {
        const data = await AuthService.login(username, password);
        setUser(data.user);
        return data;
    };

    const register = async (username, email, password) => {
        const data = await AuthService.register(username, email, password);
        setUser(data.user);
        return data;
    };

    const logout = async () => {
        // Log logout event to backend
        if (AuthService.getToken()) {
            try {
                await apiPost('/auth/logout');
            } catch (error) {
                console.error('Failed to log logout:', error);
            }
        }

        // Logout is an explicit exit (per the persistence rule), so we
        // wipe the per-user session/view/chat blobs. Without this,
        // logging out and back in as the same user — or as a different
        // user on a shared machine — would silently restore the prior
        // user's case, view, and chat into the new login.
        try {
            localStorage.removeItem('rohy_active_session');
            localStorage.removeItem('rohy_chat_history');
            localStorage.removeItem('rohy_view');
            // Per-session debrief keys are tagged with the session id; we
            // don't have it in scope here, but they'll be overwritten on
            // the next session and never read without a matching active
            // session anyway, so they self-prune.
        } catch (e) {
            console.warn('[Auth] failed to clear local session state on logout:', e.message);
        }

        AuthService.logout();
        setUser(null);
    };

    const isAdmin = () => {
        return user?.role === 'admin';
    };

    const value = {
        user,
        loading,
        login,
        register,
        logout,
        isAdmin,
        isAuthenticated: !!user
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
