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
import { act, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { resetTabIdentityForTests } from '../../services/tabIdentity';
import SignedInElsewhere from './SignedInElsewhere';

function Shell() {
    const { user, signedInElsewhere } = useAuth();
    return (
        <>
            <p>{user ? `as ${user.username}` : 'nobody'}</p>
            {signedInElsewhere && <SignedInElsewhere other={signedInElsewhere} />}
        </>
    );
}

const otherTab = (value) => act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'rohy_tab_identity', newValue: JSON.stringify(value) }));
});

describe('signed in as someone else in another tab', () => {
    beforeEach(() => { localStorage.clear(); resetTabIdentityForTests(); });

    it('announces this tab\'s user, then covers the app with a reload prompt naming the other person', async () => {
        renderWithProviders(<Shell />, { withToast: false, withVoice: false });
        await screen.findByText('as cherish18');
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
        otherTab({ userId: null, username: null });
        expect(await screen.findByRole('alertdialog')).toHaveTextContent('Signed out in another tab');
    });
});
