// Regression lock: logout left the case-edit stash (whole case, system prompt and answers) and the debrief transcripts in localStorage for the next person on a shared machine
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

vi.mock('../services/authService', () => ({
    AuthService: {
        verifyToken: vi.fn(async () => ({ id: 1, username: 'u', role: 'educator' })),
        logout: vi.fn(),
        getToken: vi.fn(() => null),
    },
}));
vi.mock('../services/apiClient', () => ({ apiPost: vi.fn(async () => ({})) }));
vi.mock('../services/tabIdentity', () => ({
    announceIdentity: vi.fn(),
    isTabStale: vi.fn(() => false),
    watchIdentity: vi.fn(() => () => {}),
}));

const { AuthProvider, useAuth } = await import('./AuthContext.jsx');

describe('logout clears what the next user must not see', () => {
    beforeEach(() => localStorage.clear());

    it('removes the case-edit stash and every per-session debrief transcript, and nothing unrelated', async () => {
        localStorage.setItem('rohy_editing_case', JSON.stringify({ system_prompt: 'secret', answers: 'MI' }));
        localStorage.setItem('rohy_discussion_history_41', '[{"role":"user"}]');
        localStorage.setItem('rohy_discussion_history_42', '[]');
        localStorage.setItem('rohy_active_session', '41');
        localStorage.setItem('rohy_ui_language', 'fi');

        let auth;
        const Probe = () => { auth = useAuth(); return null; };
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(auth.user?.id).toBe(1));

        await act(async () => { await auth.logout(); });

        expect(localStorage.getItem('rohy_editing_case')).toBeNull();
        expect(localStorage.getItem('rohy_discussion_history_41')).toBeNull();
        expect(localStorage.getItem('rohy_discussion_history_42')).toBeNull();
        expect(localStorage.getItem('rohy_active_session')).toBeNull();
        expect(localStorage.getItem('rohy_ui_language')).toBe('fi');
        expect(auth.user).toBeNull();
    });
});
