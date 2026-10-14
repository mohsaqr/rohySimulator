// Who this browser is signed in as, shared between its tabs.
//
// A browser keeps ONE sign-in (the rohy_auth cookie) for all of its tabs. Signing in as someone else
// in one tab silently turns every other open tab into that person on the server, while those tabs
// still show the previous user. On vprohy (2026-10-13) such a tab kept running for 30 minutes and
// sent 71 events tagged with the first user's session under the second user's sign-in; the server
// refused all of them (not_owner), and anything else done in that tab failed the same way.
//
// So each tab announces who it signed in as (a localStorage write, which fires a `storage` event in
// every OTHER tab of the browser). A tab that hears a different person is stale: it stops sending
// events and asks to be reloaded. Hearing its own person again (signed back in elsewhere) makes it
// valid again, because the cookie is theirs once more.
const KEY = 'rohy_tab_identity';

let stale = false;

export const isTabStale = () => stale;

export function announceIdentity(user) {
    // This tab just signed in (or out) itself: the browser's sign-in is its own again.
    stale = false;
    try {
        localStorage.setItem(KEY, JSON.stringify({
            userId: user?.id ?? null,
            username: user?.username ?? null,
            at: Date.now(),
        }));
    } catch {
        // Private mode or a full quota: nothing to share, and nothing else depends on it.
    }
}

const parse = (text) => {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
};

// Calls onChange({ userId, username }) when another tab signs in as someone else (userId null: it
// signed out), and onChange(null) when it signs back in as this tab's user. Returns the unsubscribe.
export function watchIdentity(userId, onChange) {
    const handler = (event) => {
        if (event.key !== KEY || event.newValue === null) return;
        const other = parse(event.newValue);
        if (!other) return;
        const changed = (other.userId ?? null) !== (userId ?? null);
        if (changed === stale) return;
        stale = changed;
        onChange(changed ? { userId: other.userId ?? null, username: other.username ?? null } : null);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
}

export function resetTabIdentityForTests() {
    stale = false;
}
