// Regression lock: a tab left open while another tab of the same browser signed in as someone else kept sending events under the new sign-in; vprohy refused 299 of them (not_owner, 2026-10-12..14)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceIdentity, isTabStale, resetTabIdentityForTests, watchIdentity } from './tabIdentity';

// The `storage` event a browser fires in every OTHER tab when one tab writes localStorage.
const fromOtherTab = (value, key = 'rohy_tab_identity') => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value === null ? null : JSON.stringify(value) }));
};

describe('tabIdentity', () => {
    let stop = () => {};
    beforeEach(() => { localStorage.clear(); resetTabIdentityForTests(); });
    afterEach(() => { stop(); });

    it('announces who this tab signed in as, and a sign-out as nobody', () => {
        announceIdentity({ id: 52, username: 'cherish21', role: 'student' });
        expect(JSON.parse(localStorage.getItem('rohy_tab_identity'))).toMatchObject({ userId: 52, username: 'cherish21' });
        announceIdentity(null);
        expect(JSON.parse(localStorage.getItem('rohy_tab_identity'))).toMatchObject({ userId: null, username: null });
    });

    it('another tab signing in as someone else makes this tab stale, once; signing back in as this tab\'s user clears it', () => {
        const onChange = vi.fn();
        stop = watchIdentity(49, onChange);
        fromOtherTab({ userId: 49, username: 'cherish18' });
        expect(onChange).not.toHaveBeenCalled();
        expect(isTabStale()).toBe(false);

        fromOtherTab({ userId: 52, username: 'cherish21' });
        expect(onChange).toHaveBeenLastCalledWith({ userId: 52, username: 'cherish21' });
        expect(isTabStale()).toBe(true);
        fromOtherTab({ userId: 60, username: 'cherish27' });
        expect(onChange).toHaveBeenCalledTimes(1);

        fromOtherTab({ userId: 49, username: 'cherish18' });
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(isTabStale()).toBe(false);
    });

    it('a sign-out in another tab is a change too (the cookie is gone)', () => {
        const onChange = vi.fn();
        stop = watchIdentity(1, onChange);
        fromOtherTab({ userId: null, username: null });
        expect(onChange).toHaveBeenCalledWith({ userId: null, username: null });
        expect(isTabStale()).toBe(true);
    });

    it('ignores other keys, removals and unreadable values', () => {
        const onChange = vi.fn();
        stop = watchIdentity(1, onChange);
        fromOtherTab({ userId: 2 }, 'rohy_active_session');
        fromOtherTab(null);
        window.dispatchEvent(new StorageEvent('storage', { key: 'rohy_tab_identity', newValue: '{not json' }));
        expect(onChange).not.toHaveBeenCalled();
        expect(isTabStale()).toBe(false);
    });

    it('stops listening when unsubscribed', () => {
        const onChange = vi.fn();
        watchIdentity(1, onChange)();
        fromOtherTab({ userId: 2, username: 'x' });
        expect(onChange).not.toHaveBeenCalled();
    });
});
