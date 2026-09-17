// TermsGate: the terms-of-use step between signing in and the app.
// Contracts: invisible unless acceptance is pending; the app does not mount
// until accepted; the checkbox unlocks only after reading to the end; declining
// signs out; a 409 (new version published) reloads instead of recording; a
// failed probe never locks anyone out.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TermsGate from './TermsGate';
import { apiFetch } from '../../services/apiClient';

const logout = vi.fn();
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k, v) => (v?.version ? `${k}:${v.version}` : k) }),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 7, username: 'ada' }, logout }),
}));
vi.mock('../../services/apiClient', () => {
    class ApiError extends Error {
        constructor(message, { status = 0 } = {}) { super(message); this.status = status; }
    }
    return { apiFetch: vi.fn(), ApiError };
});

const TERMS = { required: true, title: 'Rohy terms', body: '## 1. One\n\nText.', version: '1.0', accepted: false, pending: true };

function renderGate() {
    return render(<TermsGate><div data-testid="main-app" /></TermsGate>);
}

/** jsdom has no layout: make the scroll box report "at the end" on demand. */
function scrollToEnd() {
    const box = screen.getByTestId('terms-scroll');
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(box, 'scrollTop', { value: 600, configurable: true });
    fireEvent.scroll(box);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('TermsGate', () => {
    it('renders the app straight away when acceptance is not pending', async () => {
        apiFetch.mockResolvedValue({ terms: { ...TERMS, required: false, pending: false } });
        renderGate();
        expect(await screen.findByTestId('main-app')).toBeInTheDocument();
        expect(screen.queryByText('terms_accept')).not.toBeInTheDocument();
    });

    it('holds the app back until the current version is accepted', async () => {
        apiFetch.mockImplementation((url) => (url === '/terms/status'
            ? Promise.resolve({ terms: TERMS })
            : Promise.resolve({ terms: { ...TERMS, accepted: true, pending: false } })));
        renderGate();
        expect(await screen.findByText('Rohy terms')).toBeInTheDocument();
        expect(screen.getByText('1. One')).toBeInTheDocument();
        expect(screen.queryByTestId('main-app')).not.toBeInTheDocument();

        // Accept stays disabled until the text has been read to the end and ticked.
        const box = screen.getByRole('checkbox');
        const accept = screen.getByText('terms_accept').closest('button');
        scrollToEnd();
        await waitFor(() => expect(box).not.toBeDisabled());
        expect(accept).toBeDisabled();
        fireEvent.click(box);
        expect(accept).not.toBeDisabled();

        fireEvent.click(accept);
        expect(await screen.findByTestId('main-app')).toBeInTheDocument();
        expect(apiFetch).toHaveBeenCalledWith('/terms/accept', { method: 'POST', json: { version: '1.0' } });
    });

    it('signs out when the person declines', async () => {
        apiFetch.mockResolvedValue({ terms: TERMS });
        renderGate();
        fireEvent.click(await screen.findByText('terms_decline'));
        expect(logout).toHaveBeenCalled();
    });

    // Regression lock: a version published while the page was open must be
    // shown, not silently accepted under the old one.
    it('reloads the new version when the server answers 409', async () => {
        const { ApiError } = await import('../../services/apiClient');
        let statusCalls = 0;
        apiFetch.mockImplementation((url) => {
            if (url === '/terms/status') {
                statusCalls += 1;
                return Promise.resolve({ terms: statusCalls === 1 ? TERMS : { ...TERMS, version: '1.1', title: 'Rohy terms v1.1' } });
            }
            return Promise.reject(new ApiError('changed', { status: 409 }));
        });
        renderGate();
        await screen.findByText('Rohy terms');
        scrollToEnd();
        await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled());
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByText('terms_accept').closest('button'));
        expect(await screen.findByText('Rohy terms v1.1')).toBeInTheDocument();
        expect(screen.getByText('terms_updated')).toBeInTheDocument();
        expect(screen.queryByTestId('main-app')).not.toBeInTheDocument();
    });

    it('lets people through when the status probe fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        apiFetch.mockRejectedValue(new Error('offline'));
        renderGate();
        expect(await screen.findByTestId('main-app')).toBeInTheDocument();
    });
});
