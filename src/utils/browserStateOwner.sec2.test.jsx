// Per-user browser state on a shared browser (security audit 2026-10-26, L5-07).
import { beforeEach, describe, expect, it } from 'vitest';
import { adoptBrowserStateFor, purgePerUserBrowserState, previousBrowserUserId, PER_USER_KEYS } from './browserStateOwner.js';
import { isRegisteredKey } from '../storage/registry.js';

const seedPreviousPerson = (userId) => {
    localStorage.setItem('rohy_tab_identity', JSON.stringify({ userId, username: 'a', at: 1 }));
    localStorage.setItem('rohy_active_session', '{"sessionId":7}');
    localStorage.setItem('rohy_chat_history', '{"messages":[1]}');
    localStorage.setItem('rohy_editing_case', '{"id":3}');
    localStorage.setItem('rohy_discussion_history_7', '[]');
    localStorage.setItem('rohy_plugin:pathology:7:report', '{"draft":1}');
    localStorage.setItem('oyon.defaultConsent', '1');
    localStorage.setItem('oyon.consentVersion', 'v2');
    localStorage.setItem('rohy_ui_language', 'fi');
};

describe('adoptBrowserStateFor', () => {
    beforeEach(() => localStorage.clear());

    // Regression lock: an expired sign-in left the previous person's session, drafts and consent for the next one.
    it('purges the previous person\'s state when someone else signs in', () => {
        seedPreviousPerson(41);
        expect(adoptBrowserStateFor(42)).toBe(true);
        for (const k of ['rohy_active_session', 'rohy_chat_history', 'rohy_editing_case', 'rohy_discussion_history_7', 'rohy_plugin:pathology:7:report', 'oyon.defaultConsent', 'oyon.consentVersion']) {
            expect(localStorage.getItem(k), k).toBeNull();
        }
        // Browser-wide preferences are not the person's: kept.
        expect(localStorage.getItem('rohy_ui_language')).toBe('fi');
    });

    it('keeps everything for the same person, and when nobody was recorded', () => {
        seedPreviousPerson(42);
        expect(adoptBrowserStateFor('42')).toBe(false);
        expect(localStorage.getItem('rohy_active_session')).not.toBeNull();
        localStorage.removeItem('rohy_tab_identity');
        expect(adoptBrowserStateFor(43)).toBe(false);
        expect(localStorage.getItem('oyon.defaultConsent')).toBe('1');
        expect(adoptBrowserStateFor(null)).toBe(false);
    });

    it('treats a signed-out identity (userId null) as nobody', () => {
        seedPreviousPerson(null);
        expect(previousBrowserUserId()).toBeNull();
        expect(adoptBrowserStateFor(5)).toBe(false);
    });

    it('purge only touches registered per-user keys', () => {
        seedPreviousPerson(1);
        const removed = purgePerUserBrowserState();
        expect(removed).toContain('rohy_plugin:pathology:7:report');
        for (const k of removed.filter((r) => r.startsWith('rohy_'))) expect(isRegisteredKey(k), k).toBe(true);
        expect(PER_USER_KEYS).toContain('oyon.defaultConsent');
    });

    it('survives storage that throws', () => {
        const broken = { get length() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); } };
        expect(purgePerUserBrowserState(broken)).toEqual([]);
        expect(adoptBrowserStateFor(1, broken)).toBe(false);
    });
});
