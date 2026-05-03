import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AUDIO_PATTERNS } from './types';
import { DEFAULT_TTL_MS, DEFAULT_AUDIO_PATTERN, HISTORY_CAP } from './defaults';
import { routeNotification, deriveKey } from './routing';
import {
    loadPrefsSync, savePrefsSync, loadPrefsRemote, savePrefsRemote,
    loadSnoozedSync, saveSnoozedSync,
    loadAckedSync, saveAckedSync,
} from './persistence';
import { NotificationContextObject } from './NotificationContextObject';

let idCounter = 0;
const nextId = () => `n_${Date.now()}_${++idCounter}`;

export function NotificationProvider({ children }) {
    // --- Prefs (synchronous from localStorage, then merged from server async).
    const [prefs, setPrefsState] = useState(loadPrefsSync);

    useEffect(() => {
        let cancelled = false;
        loadPrefsRemote().then(remote => {
            if (cancelled || !remote) return;
            setPrefsState(prev => {
                const merged = { ...prev, ...remote };
                savePrefsSync(merged);
                return merged;
            });
        });
        return () => { cancelled = true; };
    }, []);

    const setPrefs = useCallback((patch) => {
        setPrefsState(prev => {
            const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
            savePrefsSync(next);
            // Fire-and-forget remote save; failure leaves localStorage as source of truth.
            savePrefsRemote(next);
            return next;
        });
    }, []);

    // --- Active notifications (currently visible/alive, keyed by `key`).
    // Map preserves insertion order so the toast surface renders oldest-first.
    const [active, setActive] = useState(() => new Map());

    // --- History (append-only ring buffer, capped).
    const [history, setHistory] = useState([]);

    // --- Snoozed + acked persisted across reloads. State (not refs) so the
    // exposed snoozedList / ackedList re-render correctly when they change.
    const [snoozed, setSnoozed] = useState(() => loadSnoozedSync());
    const [acked, setAcked] = useState(() => loadAckedSync());

    // External subscribers (audio surface, backend surface, console surface).
    // They get notified of *every* event that survives routing.
    const subscribersRef = useRef(new Set());
    const subscribe = useCallback((fn) => {
        subscribersRef.current.add(fn);
        return () => subscribersRef.current.delete(fn);
    }, []);

    // --- notify(): central entry point. All producers call this.
    const notify = useCallback((input) => {
        if (!input || !input.source || !input.severity) {
            console.warn('[NotificationCenter] notify() requires source + severity', input);
            return null;
        }

        const key = deriveKey(input);
        const id = nextId();
        const now = Date.now();

        const notification = {
            id,
            key,
            source: input.source,
            severity: input.severity,
            title: input.title || null,
            message: input.message || '',
            data: input.data || null,
            createdAt: now,
            ttlMs: input.ttlMs ?? DEFAULT_TTL_MS[input.severity] ?? 4000,
            audioPattern: input.audioPattern || DEFAULT_AUDIO_PATTERN[input.severity] || AUDIO_PATTERNS.BEEP,
            requiresAck: !!input.requiresAck,
            surfaces: input.surfaces, // raw hint; routing computes the final list
            count: 1,
        };

        const transient = { snoozed, acked };
        const finalSurfaces = routeNotification(notification, prefs, transient);
        notification.routedSurfaces = finalSurfaces;

        // Dedup/coalesce: if the same key is already active and within the
        // dedup window, just bump count + lastSeenAt instead of stacking.
        setActive(prev => {
            const existing = prev.get(key);
            if (existing && (now - existing.createdAt) < prefs.toastDedupeWindowMs) {
                const merged = {
                    ...existing,
                    count: existing.count + 1,
                    message: notification.message || existing.message,
                    lastSeenAt: now,
                    routedSurfaces: finalSurfaces,
                };
                const next = new Map(prev);
                next.set(key, merged);
                return next;
            }
            // Either new or outside dedup window — replace.
            if (finalSurfaces.length === 0) {
                // Still record in history below, but don't show on visible surfaces.
                return prev;
            }
            const next = new Map(prev);
            next.set(key, notification);
            return next;
        });

        // History always records (so silenced notifications are still auditable).
        setHistory(prev => {
            const appended = [...prev, { ...notification, atTs: now }];
            if (appended.length > HISTORY_CAP) appended.splice(0, appended.length - HISTORY_CAP);
            return appended;
        });

        // Fire subscribers (audio/backend/console). They self-filter by surface.
        if (finalSurfaces.length > 0) {
            subscribersRef.current.forEach(fn => {
                try { fn({ type: 'notify', notification }); } catch (e) {
                    console.warn('[NotificationCenter] subscriber error:', e);
                }
            });
        }

        return id;
    }, [prefs, snoozed, acked]);

    // resolve(key): producer signals "this condition cleared". Removes from
    // active, clears any acked state for the key (so a re-trigger can fire).
    const resolve = useCallback((key) => {
        if (!key) return;
        setActive(prev => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
        setAcked(prev => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            saveAckedSync(next);
            return next;
        });
        subscribersRef.current.forEach(fn => {
            try { fn({ type: 'resolve', key }); } catch (e) {
                console.warn('[NotificationCenter] subscriber error:', e);
            }
        });
    }, []);

    // ack(key): user dismissed. Suppresses re-fires until producer calls
    // resolve(key) (e.g. vital normalises). Persisted so reload doesn't unmute.
    const ack = useCallback((key) => {
        if (!key) return;
        setAcked(prev => {
            const next = new Set(prev);
            next.add(key);
            saveAckedSync(next);
            return next;
        });
        setActive(prev => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
        subscribersRef.current.forEach(fn => {
            try { fn({ type: 'ack', key }); } catch { /* ignore */ }
        });
    }, []);

    const ackAll = useCallback(() => {
        setActive(prevActive => {
            setAcked(prevAcked => {
                const next = new Set(prevAcked);
                for (const key of prevActive.keys()) next.add(key);
                saveAckedSync(next);
                return next;
            });
            return new Map();
        });
    }, []);

    // snooze(key, mins): suppress for N minutes. Persisted.
    const snooze = useCallback((key, minutes) => {
        if (!key) return;
        const dur = minutes ?? prefs.snoozeDuration;
        const until = Date.now() + dur * 60 * 1000;
        setSnoozed(prev => {
            const next = new Map(prev);
            next.set(key, until);
            saveSnoozedSync(next);
            return next;
        });
        setActive(prev => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
        // Auto-clear when this snooze expires so UI updates.
        const remaining = until - Date.now();
        if (remaining > 0) {
            setTimeout(() => {
                setSnoozed(prev => {
                    if (prev.get(key) !== until) return prev;
                    const next = new Map(prev);
                    next.delete(key);
                    saveSnoozedSync(next);
                    return next;
                });
            }, remaining + 50);
        }
        subscribersRef.current.forEach(fn => {
            try { fn({ type: 'snooze', key, until }); } catch { /* ignore */ }
        });
    }, [prefs.snoozeDuration]);

    const snoozeAll = useCallback((minutes) => {
        const dur = minutes ?? prefs.snoozeDuration;
        const until = Date.now() + dur * 60 * 1000;
        setActive(prevActive => {
            setSnoozed(prevSnoozed => {
                const next = new Map(prevSnoozed);
                for (const key of prevActive.keys()) next.set(key, until);
                saveSnoozedSync(next);
                return next;
            });
            return new Map();
        });
    }, [prefs.snoozeDuration]);

    // dismiss(id): user closed a transient toast (no ack semantics, just
    // hides the current one — re-fires are allowed).
    const dismiss = useCallback((idOrKey) => {
        setActive(prev => {
            // Look up by id first (toast X button), then by key.
            let foundKey = null;
            for (const [k, v] of prev.entries()) {
                if (v.id === idOrKey || k === idOrKey) { foundKey = k; break; }
            }
            if (!foundKey) return prev;
            const next = new Map(prev);
            next.delete(foundKey);
            return next;
        });
    }, []);

    // pause(id) / resume(id): freezes the auto-expiry countdown for a single
    // notification. ToastSurface calls these on mouse-enter/leave so a user
    // who's reading the toast can take their time. resume() bumps lastSeenAt
    // to now, giving the full remaining TTL again — over-generous on purpose
    // (a user who hovered + walked away gets a fresh window when they come
    // back, instead of 0 ms).
    const pause = useCallback((idOrKey) => {
        setActive(prev => {
            let foundKey = null;
            for (const [k, v] of prev.entries()) {
                if (v.id === idOrKey || k === idOrKey) { foundKey = k; break; }
            }
            if (!foundKey) return prev;
            const cur = prev.get(foundKey);
            if (cur.paused) return prev;
            const next = new Map(prev);
            next.set(foundKey, { ...cur, paused: true });
            return next;
        });
    }, []);

    const resume = useCallback((idOrKey) => {
        setActive(prev => {
            let foundKey = null;
            for (const [k, v] of prev.entries()) {
                if (v.id === idOrKey || k === idOrKey) { foundKey = k; break; }
            }
            if (!foundKey) return prev;
            const cur = prev.get(foundKey);
            if (!cur.paused) return prev;
            const next = new Map(prev);
            next.set(foundKey, { ...cur, paused: false, lastSeenAt: Date.now() });
            return next;
        });
    }, []);

    // Auto-expire transient toasts based on ttlMs. Skips:
    //  - notifications with requiresAck (clinical critical, banners with Ack)
    //  - notifications with ttlMs === 0 (sticky)
    //  - notifications currently paused by ToastSurface hover
    useEffect(() => {
        if (active.size === 0) return undefined;
        const now = Date.now();
        let nextExpiry = Infinity;
        for (const n of active.values()) {
            if (!n.ttlMs || n.requiresAck || n.paused) continue;
            const expiresAt = (n.lastSeenAt || n.createdAt) + n.ttlMs;
            if (expiresAt < nextExpiry) nextExpiry = expiresAt;
        }
        if (!isFinite(nextExpiry)) return undefined;
        const wait = Math.max(0, nextExpiry - now);
        const t = setTimeout(() => {
            const cutoff = Date.now();
            setActive(prev => {
                let changed = false;
                const next = new Map(prev);
                for (const [k, n] of prev.entries()) {
                    if (n.requiresAck || !n.ttlMs || n.paused) continue;
                    const exp = (n.lastSeenAt || n.createdAt) + n.ttlMs;
                    if (exp <= cutoff) {
                        next.delete(k);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, wait);
        return () => clearTimeout(t);
    }, [active]);

    // Periodic snooze GC (also handles the rare case where the setTimeout
    // chain dropped a tick due to tab backgrounding).
    useEffect(() => {
        const interval = setInterval(() => {
            setSnoozed(prev => {
                const now = Date.now();
                let changed = false;
                const next = new Map(prev);
                for (const [k, until] of prev.entries()) {
                    if (until <= now) {
                        next.delete(k);
                        changed = true;
                    }
                }
                if (changed) saveSnoozedSync(next);
                return changed ? next : prev;
            });
        }, 30000);
        return () => clearInterval(interval);
    }, []);

    // Snapshots that surface components and consumers can read. We expose
    // raw `until` (epoch ms) and let consumers compute remaining at render
    // time — keeping useMemo a pure mapping over state.
    const snoozedList = useMemo(
        () => Array.from(snoozed.entries()).map(([key, until]) => ({ key, until })),
        [snoozed]
    );
    const ackedList = useMemo(() => Array.from(acked), [acked]);
    const activeList = useMemo(() => Array.from(active.values()), [active]);

    const value = useMemo(() => ({
        // Producer API
        notify,
        resolve,
        // Lifecycle (user actions)
        ack,
        ackAll,
        snooze,
        snoozeAll,
        dismiss,
        // Hover-pause for toasts (surface-driven)
        pause,
        resume,
        // State snapshots (used by surfaces and the alarm tab)
        active: activeList,
        history,
        snoozed: snoozedList,
        acked: ackedList,
        // Prefs
        prefs,
        setPrefs,
        // Subscribe for transient surfaces (audio/backend/console)
        subscribe,
    }), [notify, resolve, ack, ackAll, snooze, snoozeAll, dismiss, pause, resume, activeList, history, snoozedList, ackedList, prefs, setPrefs, subscribe]);

    return (
        <NotificationContextObject.Provider value={value}>
            {children}
        </NotificationContextObject.Provider>
    );
}
