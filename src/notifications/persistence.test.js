import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
    loadPrefsSync,
    savePrefsSync,
    loadSnoozedSync,
    saveSnoozedSync,
    loadAckedSync,
    saveAckedSync,
} from './persistence';
import { DEFAULT_PREFS } from './defaults';

// Audit #18: lock the per-user scoping + one-shot legacy-key migration in
// notifications/persistence.js. The audit flagged that on shared
// workstations, user A's acks must not silence alarms for user B —
// scoping is what enforces that, and the migration is what protects
// users mid-deploy from losing their pre-scoping preferences.

const LEGACY = {
    prefs: 'rohy_notification_prefs',
    snoozed: 'rohy_notification_snoozed',
    acked: 'rohy_notification_acked',
};

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    localStorage.clear();
});

describe('persistence — per-user scoping', () => {
    it('scopes prefs per userId so user A and user B do not collide', () => {
        savePrefsSync({ ...DEFAULT_PREFS, audioMuted: true }, 'user-a');
        savePrefsSync({ ...DEFAULT_PREFS, audioMuted: false }, 'user-b');

        expect(loadPrefsSync('user-a').audioMuted).toBe(true);
        expect(loadPrefsSync('user-b').audioMuted).toBe(false);
    });

    it('scopes acked-set per userId', () => {
        saveAckedSync(new Set(['alarm:hr_high']), 'user-a');
        saveAckedSync(new Set(['alarm:spo2_low']), 'user-b');

        expect([...loadAckedSync('user-a')]).toEqual(['alarm:hr_high']);
        expect([...loadAckedSync('user-b')]).toEqual(['alarm:spo2_low']);
    });

    it('scopes snoozed-map per userId', () => {
        const future = Date.now() + 60_000;
        saveSnoozedSync(new Map([['alarm:hr_high', future]]), 'user-a');
        saveSnoozedSync(new Map([['alarm:spo2_low', future]]), 'user-b');

        expect([...loadSnoozedSync('user-a').keys()]).toEqual(['alarm:hr_high']);
        expect([...loadSnoozedSync('user-b').keys()]).toEqual(['alarm:spo2_low']);
    });

    it('null/undefined userId routes to the anon slot', () => {
        savePrefsSync({ ...DEFAULT_PREFS, audioMuted: true }, null);
        expect(loadPrefsSync(undefined).audioMuted).toBe(true);
        expect(loadPrefsSync(null).audioMuted).toBe(true);
        expect(localStorage.getItem(`${LEGACY.prefs}:anon`)).toBeTruthy();
    });

    it('numeric and string userIds with the same digits collide (CONTRACT)', () => {
        // The scoper coerces to String(userId), so 7 and '7' map to the
        // same slot. This is the documented behaviour — locking it so
        // future "be type-strict" refactors don't silently regress it.
        savePrefsSync({ ...DEFAULT_PREFS, audioMuted: true }, 7);
        expect(loadPrefsSync('7').audioMuted).toBe(true);
    });
});

describe('persistence — one-shot legacy-key migration', () => {
    it('migrates an unscoped legacy prefs key into the user slot, then deletes the legacy', () => {
        // Pre-deploy: user had ack data in the unscoped key.
        const legacyPrefs = JSON.stringify({ audioMuted: true, snoozeDuration: 15 });
        localStorage.setItem(LEGACY.prefs, legacyPrefs);

        // First post-deploy load: should pull the legacy value into the user's slot.
        const loaded = loadPrefsSync('user-x');
        expect(loaded.audioMuted).toBe(true);
        expect(loaded.snoozeDuration).toBe(15);

        // Legacy key is gone; user-scoped key now carries the value.
        expect(localStorage.getItem(LEGACY.prefs)).toBeNull();
        expect(localStorage.getItem(`${LEGACY.prefs}:user-x`)).toBe(legacyPrefs);
    });

    it('migrates legacy acked + snoozed analogously', () => {
        localStorage.setItem(LEGACY.acked, JSON.stringify(['alarm:hr_high']));
        const future = Date.now() + 60_000;
        localStorage.setItem(LEGACY.snoozed, JSON.stringify({ 'alarm:spo2_low': future }));

        expect([...loadAckedSync('user-y')]).toEqual(['alarm:hr_high']);
        expect([...loadSnoozedSync('user-y').keys()]).toEqual(['alarm:spo2_low']);

        expect(localStorage.getItem(LEGACY.acked)).toBeNull();
        expect(localStorage.getItem(LEGACY.snoozed)).toBeNull();
    });

    it('does NOT clobber a scoped value that already exists', () => {
        // CONTRACT: migration is one-shot. If the user already has a
        // post-deploy scoped value, the legacy is left alone and NOT
        // migrated on top of it. This is the safety against rolling-deploy
        // races where one tab wrote scoped state before another tab read
        // the legacy.
        savePrefsSync({ ...DEFAULT_PREFS, audioMuted: false }, 'user-z');
        localStorage.setItem(LEGACY.prefs, JSON.stringify({ audioMuted: true }));

        const loaded = loadPrefsSync('user-z');
        // Scoped wins.
        expect(loaded.audioMuted).toBe(false);
        // Legacy key is left in place (not migrated, not deleted).
        expect(localStorage.getItem(LEGACY.prefs)).toBeTruthy();
    });

    it('migration only fires for the FIRST user to log in after the deploy', () => {
        // User A logs in first → gets the migrated value, legacy is deleted.
        // User B logs in second → starts with defaults, no legacy to inherit.
        const legacy = JSON.stringify({ audioMuted: true });
        localStorage.setItem(LEGACY.prefs, legacy);

        expect(loadPrefsSync('user-a').audioMuted).toBe(true);
        // Now load user B — they should get DEFAULT_PREFS (audioMuted=false),
        // NOT user A's migrated value.
        expect(loadPrefsSync('user-b').audioMuted).toBe(DEFAULT_PREFS.audioMuted);
    });

    it('handles a legacy snoozed map with already-expired entries', () => {
        // The load function filters out entries whose `until` is in the
        // past. Legacy data may include stale entries; the migration must
        // not crash and the resulting map must be clean.
        const past = Date.now() - 60_000;
        const future = Date.now() + 60_000;
        localStorage.setItem(LEGACY.snoozed, JSON.stringify({
            'alarm:old': past,
            'alarm:fresh': future,
        }));

        const map = loadSnoozedSync('user-q');
        expect([...map.keys()]).toEqual(['alarm:fresh']);
    });
});

describe('persistence — graceful degradation', () => {
    it('returns DEFAULT_PREFS when scoped value is unparseable JSON', () => {
        localStorage.setItem(`${LEGACY.prefs}:user-x`, '{not json');
        expect(loadPrefsSync('user-x')).toEqual(DEFAULT_PREFS);
    });

    it('returns empty Set when acked value is unparseable JSON', () => {
        localStorage.setItem(`${LEGACY.acked}:user-x`, '{not json');
        expect([...loadAckedSync('user-x')]).toEqual([]);
    });
});
