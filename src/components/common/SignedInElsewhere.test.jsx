// Regression lock: a tab left open while another tab of the same browser signed in as someone else kept showing the first user and working as the second (vprohy, 2026-10-13); now it says so and offers a reload
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => null,
        verifyToken: vi.fn(async () => ({ id: 49, username: 'cherish18', role: 'student' })),
        logout: vi.fn(),
    },
}));

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { resetTabIdentityForTests } from '../../services/tabIdentity';
import SignedInElsewhere from './SignedInElsewhere';

function Shell() {
    const { user, signedInElsewhere, logout } = useAuth();
    return (
        <>
            <p>{user ? `as ${user.username}` : 'nobody'}</p>
            <button type="button">Underneath</button>
            <button type="button" onClick={logout}>Log out</button>
            {signedInElsewhere && <SignedInElsewhere other={signedInElsewhere} />}
        </>
    );
}

// The sign-in shows before the effect that listens to the other tabs has run; flush it so the
// storage event below is heard (without this the first test failed about one run in eight).
const settled = () => act(async () => {});

const otherTab = (value) => act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'rohy_tab_identity', newValue: JSON.stringify(value) }));
});

describe('signed in as someone else in another tab', () => {
    beforeEach(() => { localStorage.clear(); resetTabIdentityForTests(); });

    it('announces this tab\'s user, then covers the app with a reload prompt naming the other person', async () => {
        renderWithProviders(<Shell />, { withToast: false, withVoice: false });
        await screen.findByText('as cherish18');
        await settled();
        expect(JSON.parse(localStorage.getItem('rohy_tab_identity'))).toMatchObject({ userId: 49, username: 'cherish18' });
        expect(screen.queryByRole('alertdialog')).toBeNull();

        otherTab({ userId: 52, username: 'cherish21' });
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent('Signed in as someone else');
        expect(dialog).toHaveTextContent('This browser is now signed in as cherish21 in another tab.');
        const reload = screen.getByRole('button', { name: 'Reload' });
        await waitFor(() => expect(reload).toHaveFocus());

        otherTab({ userId: 49, username: 'cherish18' });
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    });

    it('says "signed out" when the other tab signed out', async () => {
        renderWithProviders(<Shell />, { withToast: false, withVoice: false });
        await screen.findByText('as cherish18');
        await settled();
        otherTab({ userId: null, username: null });
        expect(await screen.findByRole('alertdialog')).toHaveTextContent('Signed out in another tab');
    });
});

// Regression lock: the overlay focused Reload but did not trap focus, the app underneath stayed interactive, and Escape reached the dialogs below it (FI-0010 review F17)
describe('the signed-in-elsewhere overlay blocks the app underneath', () => {
    beforeEach(() => { localStorage.clear(); resetTabIdentityForTests(); });

    const goStale = async () => {
        const view = renderWithProviders(<Shell />, { withToast: false, withVoice: false });
        await screen.findByText('as cherish18');
        await settled();
        otherTab({ userId: 52, username: 'cherish21' });
        await screen.findByRole('alertdialog');
        const reload = screen.getByRole('button', { name: 'Reload' });
        await waitFor(() => expect(reload).toHaveFocus());
        return { view, reload };
    };

    it('makes the rest of the page inert, and gives it back when the tab is whole again', async () => {
        const { view } = await goStale();
        expect(view.container).toHaveAttribute('inert');
        expect(screen.getByTestId('signed-in-elsewhere').closest('[inert]')).toBeNull();
        otherTab({ userId: 49, username: 'cherish18' });
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(view.container).not.toHaveAttribute('inert');
    });

    it('keeps Tab and Shift+Tab on Reload, and pulls focus back from underneath', async () => {
        const { reload } = await goStale();
        fireEvent.keyDown(reload, { key: 'Tab' });
        expect(reload).toHaveFocus();
        fireEvent.keyDown(reload, { key: 'Tab', shiftKey: true });
        expect(reload).toHaveFocus();
        act(() => { screen.getByRole('button', { name: 'Underneath', hidden: true }).focus(); });
        expect(reload).toHaveFocus();
    });

    it('does nothing on Escape, and the Escape never reaches a dialog underneath', async () => {
        const underneath = vi.fn();
        window.addEventListener('keydown', underneath);
        try {
            const { reload } = await goStale();
            fireEvent.keyDown(reload, { key: 'Escape' });
            expect(screen.getByRole('alertdialog')).toBeInTheDocument();
            expect(reload).toHaveFocus();
            expect(underneath).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', underneath);
        }
    });

    it('a logout from the stale tab does not sign the other person out', async () => {
        await goStale();
        // What the other tab wrote into the browser's shared storage.
        localStorage.setItem('rohy_tab_identity', JSON.stringify({ userId: 52, username: 'cherish21' }));
        localStorage.setItem('rohy_active_session', JSON.stringify({ sessionId: 5 }));
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            await act(async () => { screen.getByRole('button', { name: 'Log out', hidden: true }).click(); });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(JSON.parse(localStorage.getItem('rohy_tab_identity'))).toMatchObject({ userId: 52 });
            expect(localStorage.getItem('rohy_active_session')).not.toBeNull();
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
