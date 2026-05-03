import { DEFAULT_PREFS } from './defaults';
import { AuthService } from '../services/authService';
import { apiUrl } from '../config/api';

const LS_PREFS = 'rohy_notification_prefs';
const LS_SNOOZED = 'rohy_notification_snoozed';
const LS_ACKED = 'rohy_notification_acked';

// Load prefs synchronously from localStorage so the very first render uses
// the right values (avoids the alarm-defaults race that the legacy hook had).
export function loadPrefsSync() {
    try {
        const raw = localStorage.getItem(LS_PREFS);
        if (!raw) return { ...DEFAULT_PREFS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_PREFS, ...parsed };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export function savePrefsSync(prefs) {
    try {
        localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
    } catch {
        // localStorage full or unavailable — non-fatal.
    }
}

// Snoozed map persisted as { key: untilEpochMs }.
export function loadSnoozedSync() {
    try {
        const raw = localStorage.getItem(LS_SNOOZED);
        if (!raw) return new Map();
        const obj = JSON.parse(raw);
        const now = Date.now();
        const m = new Map();
        for (const [k, until] of Object.entries(obj)) {
            if (until > now) m.set(k, until);
        }
        return m;
    } catch {
        return new Map();
    }
}

export function saveSnoozedSync(snoozed) {
    try {
        const obj = {};
        for (const [k, v] of snoozed.entries()) obj[k] = v;
        localStorage.setItem(LS_SNOOZED, JSON.stringify(obj));
    } catch { /* ignore */ }
}

// Acked is just a set of keys currently acknowledged (suppress until producer
// calls resolve(key)). Persisted so a refresh doesn't unsilence everything.
export function loadAckedSync() {
    try {
        const raw = localStorage.getItem(LS_ACKED);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw));
    } catch {
        return new Set();
    }
}

export function saveAckedSync(acked) {
    try {
        localStorage.setItem(LS_ACKED, JSON.stringify(Array.from(acked)));
    } catch { /* ignore */ }
}

// Backend prefs. Loaded async after login; merged on top of localStorage so
// the user's settings follow them between machines. Failure is non-fatal —
// we keep the localStorage copy.
export async function loadPrefsRemote() {
    try {
        const token = AuthService.getToken();
        if (!token) return null;
        const res = await fetch(apiUrl('/notification-prefs'), {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.prefs || null;
    } catch {
        return null;
    }
}

export async function savePrefsRemote(prefs) {
    try {
        const token = AuthService.getToken();
        if (!token) return false;
        const res = await fetch(apiUrl('/notification-prefs'), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ prefs }),
        });
        return res.ok;
    } catch {
        return false;
    }
}
