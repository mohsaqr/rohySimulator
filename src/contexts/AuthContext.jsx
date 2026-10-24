import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthService } from '../services/authService';
import { apiPost } from '../services/apiClient';
import { announceIdentity, isTabStale, watchIdentity } from '../services/tabIdentity';
import { STORAGE_REGISTRY } from '../storage/registry';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

// The auth state when there is a provider, null outside one — for components
// that only key local data by the signed-in user and render fine without it.
export const useOptionalAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    // Set when another tab of this browser signed in as someone else (or signed out): this tab's
    // requests now carry that person's cookie, so it must stop and be reloaded (services/tabIdentity).
    const [signedInElsewhere, setSignedInElsewhere] = useState(null);

    useEffect(() => {
        // Check if user is already logged in on mount
        const verifyUser = async () => {
            try {
                const userData = await AuthService.verifyToken();
                setUser(userData);
                if (userData) announceIdentity(userData);
            } catch (error) {
                console.error('Token verification failed:', error);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };

        verifyUser();
    }, []);

    // JWT refresh scheduling.
    //
    // Pre-fix this used a hardcoded 3h setInterval, which broke for any
    // user whose tab was active longer than the 4h JWT TTL: the first
    // tick fired AFTER the token had already expired, every API call
    // 403'd with "Invalid or expired token" in between, and the user saw
    // a "no cases / no users / no analytics" screen until they manually
    // re-logged-in. Reported 2026-05-07.
    //
    // The fix decodes the JWT's `exp` claim and schedules the FIRST
    // refresh for (exp - now - 5min) — i.e. five minutes before expiry,
    // regardless of when the user mounted the app. After a successful
    // refresh, we re-decode the new token's exp and schedule again.
    // If the exp claim can't be read (legacy token, malformed payload),
    // we fall back to a conservative 30 minutes.
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        let timer = null;
        let refreshing = false;
        let lastAttemptMs = 0;

        const decodeJwtExp = (token) => {
            try {
                const payload = token.split('.')[1];
                const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
                const json = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
                return Number.isFinite(json.exp) ? json.exp * 1000 : null;
            } catch (err) {
                console.warn('[auth] failed to decode JWT exp claim, using fallback refresh interval', err);
                return null;
            }
        };

        const computeDelay = () => {
            const token = AuthService.getToken();
            const FALLBACK_MS = 30 * 60 * 1000; // 30 min
            const SAFETY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
            const MIN_DELAY_MS = 5 * 1000; // never schedule sooner than 5s
            if (!token) return FALLBACK_MS;
            const expMs = decodeJwtExp(token);
            if (!expMs) return FALLBACK_MS;
            const delay = expMs - Date.now() - SAFETY_BUFFER_MS;
            return Math.max(MIN_DELAY_MS, delay);
        };

        const tick = async () => {
            if (cancelled || refreshing) return;
            // A stale tab's cookie belongs to whoever signed in elsewhere:
            // refreshing (or a failed refresh's logout) would act on them.
            // Wait for the reload; check again in a minute.
            if (isTabStale()) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(tick, 60 * 1000);
                return;
            }
            refreshing = true;
            lastAttemptMs = Date.now();
            if (timer) { clearTimeout(timer); timer = null; }
            try {
                const result = await AuthService.refreshToken();
                if (cancelled) return;
                if (result) {
                    // Schedule the next refresh based on the freshly-issued token.
                    timer = setTimeout(tick, computeDelay());
                    return;
                }
                // Refresh failed — but that is NOT proof the session is dead.
                // A laptop waking from sleep often loses the first request to
                // a not-yet-up network; hard-logging-out here threw users out
                // of running cases. Ask /auth/verify and use its full
                // contract: a user object means the session still stands
                // (retry the refresh shortly); null means the server
                // definitively rejected it (log out); a THROW is a network
                // failure (retry — do not log out on a wifi blip). NB
                // verifyToken never threw on rejection historically, so a
                // catch-only branch here was dead code and a revoked session
                // kept its zombie UI forever.
                try {
                    const stillValid = await AuthService.verifyToken();
                    if (cancelled) return;
                    if (stillValid) {
                        timer = setTimeout(tick, 60 * 1000);
                    } else {
                        AuthService.logout();
                        setUser(null);
                    }
                } catch {
                    if (cancelled) return;
                    timer = setTimeout(tick, 60 * 1000);
                }
            } finally {
                refreshing = false;
            }
        };

        // Wake guard. setTimeout does not run while the machine sleeps and
        // is throttled in background tabs, so the "5 minutes before expiry"
        // refresh can fire hours late — after the token is already dead.
        // Whenever the tab becomes visible/focused/online again, refresh
        // immediately if the token is inside the wake window (or, for
        // cookie-mode users whose exp we cannot read, if we haven't tried
        // recently). This is what keeps a login alive across sleep gaps.
        const WAKE_WINDOW_MS = 60 * 60 * 1000; // refresh on wake if <1h left
        const WAKE_MIN_GAP_MS = 10 * 60 * 1000; // cookie mode: at most every 10 min
        const onWake = () => {
            if (cancelled || refreshing) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            const token = AuthService.getToken();
            if (token) {
                const expMs = decodeJwtExp(token);
                if (expMs && expMs - Date.now() > WAKE_WINDOW_MS) return; // plenty of runway
            } else if (Date.now() - lastAttemptMs < WAKE_MIN_GAP_MS) {
                return;
            }
            tick();
        };
        window.addEventListener('focus', onWake);
        window.addEventListener('online', onWake);
        document.addEventListener('visibilitychange', onWake);

        // First refresh fires based on the existing token's exp.
        timer = setTimeout(tick, computeDelay());
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener('focus', onWake);
            window.removeEventListener('online', onWake);
            document.removeEventListener('visibilitychange', onWake);
        };
    }, [user]);

    const login = async (username, password) => {
        const data = await AuthService.login(username, password);
        setUser(data.user);
        announceIdentity(data.user);
        return data;
    };

    // `extra` carries the invite token when one was used. Guarded setUser because
    // a future approval-mode registration answers 202 with NO user and NO token —
    // setUser(undefined) there would log the caller into a ghost session.
    const register = async (username, email, password, extra = {}) => {
        const data = await AuthService.register(username, email, password, extra);
        if (data?.user) {
            setUser(data.user);
            announceIdentity(data.user);
        }
        return data;
    };

    const logout = async () => {
        // A stale tab (another tab signed in as someone else) holds THAT
        // person's cookie, token and shared localStorage: revoking the
        // session, wiping the keys or announcing "signed out" here would sign
        // them out, not this tab's user. It only lets go of its own user.
        if (isTabStale()) {
            setUser(null);
            return;
        }
        // Always hit /auth/logout — the server needs to revoke the
        // active_sessions row and clear the HttpOnly rohy_auth cookie.
        // Cookie-only users have no localStorage token, so a token-gated
        // call (the pre-F-003 shape) silently skipped the server side and
        // left the cookie alive: refresh would re-authenticate, and on a
        // shared machine a second user could resume the prior session.
        // apiPost rides credentials:'include' so the cookie path still works.
        try {
            await apiPost('/auth/logout');
        } catch (error) {
            console.error('Failed to log logout:', error);
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
            localStorage.removeItem('rohy_scenario_anchor');
            localStorage.removeItem('rohy_session_pause');
            // The case-edit stash holds a whole case — system prompt and
            // answer material included — and the debrief transcripts are
            // keyed per session, so neither is cleared by the removes above.
            // Both would otherwise outlive the sign-in on a shared machine.
            localStorage.removeItem('rohy_editing_case');
            const debriefPrefix = STORAGE_REGISTRY.rohy_discussion_history.keyBuilder('');
            // Storage.key(i), not Object.keys(): the latter is not part of the
            // Storage contract. Collected first — removing while indexing shifts keys.
            Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
                .filter((key) => typeof key === 'string' && key.startsWith(debriefPrefix))
                .forEach((key) => localStorage.removeItem(key));
        } catch (e) {
            console.warn('[Auth] failed to clear local session state on logout:', e.message);
        }

        AuthService.logout();
        setUser(null);
        announceIdentity(null);
    };

    const isAdmin = () => {
        return user?.role === 'admin';
    };

    useEffect(() => {
        if (!user?.id) return undefined;
        return watchIdentity(user.id, setSignedInElsewhere);
    }, [user?.id]);

    const value = {
        user,
        signedInElsewhere,
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
