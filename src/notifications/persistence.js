import { DEFAULT_PREFS } from './defaults';
import { AuthService } from '../services/authService';
import { apiUrl } from '../config/api';

// Per-user localStorage scoping. On a shared workstation, user A's acks /
// snoozes / DND must not silence alarms for user B. Storage keys are
// `${prefix}:${userId}` (or `${prefix}:anon` when no user is signed in).
//
// One-shot migration: the first time a user reads their scoped key after
// upgrading, if it's missing AND the legacy unscoped key exists, the legacy
// value is copied into the current user's slot and the legacy key is
// deleted. Later sign-ins by other users start clean.
const LEGACY_KEYS = {
    prefs: 'rohy_notification_prefs',
    snoozed: 'rohy_notification_snoozed',
    acked: 'rohy_notification_acked',
};

function scopedKey(name, userId) {
    const id = userId == null || userId === '' ? 'anon' : String(userId);
    return `${LEGACY_KEYS[name]}:${id}`;
}

function migrateLegacyOnce(name, userId) {
    try {
        const scoped = scopedKey(name, userId);
        if (localStorage.getItem(scoped) !== null) return;
        const legacy = localStorage.getItem(LEGACY_KEYS[name]);
        if (legacy === null) return;
        localStorage.setItem(scoped, legacy);
        localStorage.removeItem(LEGACY_KEYS[name]);
    } catch {
        // localStorage unavailable — non-fatal, just skip migration.
    }
}

// Load prefs synchronously from localStorage so the very first render uses
// the right values (avoids the alarm-defaults race that the legacy hook had).
export function loadPrefsSync(userId) {
    migrateLegacyOnce('prefs', userId);
    try {
        const raw = localStorage.getItem(scopedKey('prefs', userId));
        if (!raw) return { ...DEFAULT_PREFS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_PREFS, ...parsed };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export function savePrefsSync(prefs, userId) {
    try {
        localStorage.setItem(scopedKey('prefs', userId), JSON.stringify(prefs));
    } catch {
        // localStorage full or unavailable — non-fatal.
    }
}

// Snoozed map persisted as { key: untilEpochMs }.
export function loadSnoozedSync(userId) {
    migrateLegacyOnce('snoozed', userId);
    try {
        const raw = localStorage.getItem(scopedKey('snoozed', userId));
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

export function saveSnoozedSync(snoozed, userId) {
    try {
        const obj = {};
        for (const [k, v] of snoozed.entries()) obj[k] = v;
        localStorage.setItem(scopedKey('snoozed', userId), JSON.stringify(obj));
    } catch { /* ignore */ }
}

// Acked is just a set of keys currently acknowledged (suppress until producer
// calls resolve(key)). Persisted so a refresh doesn't unsilence everything.
export function loadAckedSync(userId) {
    migrateLegacyOnce('acked', userId);
    try {
        const raw = localStorage.getItem(scopedKey('acked', userId));
        if (!raw) return new Set();
        return new Set(JSON.parse(raw));
    } catch {
        return new Set();
    }
}

export function saveAckedSync(acked, userId) {
    try {
        localStorage.setItem(scopedKey('acked', userId), JSON.stringify(Array.from(acked)));
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
