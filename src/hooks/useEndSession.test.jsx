// Regression lock: a failed PUT /sessions/:id/end was swallowed and the UI flipped to ended/debrief anyway, while the server still had the session running (FI-0010 review F10); the ended state is now committed only after the server accepts the end, and a failure is said through the notification center with a retry
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const apiPut = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, apiPut: (...a) => apiPut(...a) };
});

import { renderWithProviders } from '../../tests/utils/renderWithProviders.jsx';
import ToastSurface from '../notifications/surfaces/ToastSurface.jsx';
import EndSessionConfirm from '../components/common/EndSessionConfirm.jsx';
import { useEndSession } from './useEndSession';
import { endSessionOnServer } from '../services/sessionEnd';

const FAILED = 'The case could not be ended and is still running. Check your connection and try again.';

function Harness({ sessionId = 7, onEnded }) {
    const { ending, failed, endSession } = useEndSession({ sessionId, onEnded });
    return (
        <>
            <EndSessionConfirm onCancel={() => {}} onConfirm={endSession} busy={ending} failed={failed} />
            <ToastSurface />
        </>
    );
}
const mount = (props) => renderWithProviders(<Harness {...props} />, { withVoice: false, withToast: false, withConversation: false });

afterEach(() => {
    cleanup();
    apiPut.mockReset();
    vi.restoreAllMocks();
});

describe('ending a session', () => {
    it('commits the ended state only after the server accepted the end', async () => {
        apiPut.mockResolvedValue({ ok: true });
        const onEnded = vi.fn();
        mount({ onEnded });
        fireEvent.click(screen.getByTestId('end-session-confirm'));
        await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
        expect(apiPut).toHaveBeenCalledWith('/sessions/7/end');
        expect(screen.queryByTestId('end-session-failed')).toBeNull();
    });

    it('keeps the case running on a failed end, says so, and offers a retry that then succeeds', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        apiPut.mockRejectedValueOnce(Object.assign(new Error('Network error: request failed'), { status: 0, code: 'NETWORK' }));
        const onEnded = vi.fn();
        mount({ onEnded });
        fireEvent.click(screen.getByTestId('end-session-confirm'));

        expect(await screen.findByTestId('end-session-failed')).toHaveTextContent(FAILED);
        expect(onEnded).not.toHaveBeenCalled();
        // The notification center's toast carries the same localized message.
        expect(screen.getAllByText(FAILED)).toHaveLength(2);
        const retry = screen.getByTestId('end-session-confirm');
        expect(retry).toHaveTextContent('Try again');

        apiPut.mockResolvedValueOnce({ ok: true });
        fireEvent.click(retry);
        await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
        expect(apiPut).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('end-session-failed')).toBeNull();
    });

    it('sends one request for a double click', async () => {
        let release;
        apiPut.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const onEnded = vi.fn();
        mount({ onEnded });
        const button = screen.getByTestId('end-session-confirm');
        fireEvent.click(button);
        fireEvent.click(button);
        expect(apiPut).toHaveBeenCalledTimes(1);
        await act(async () => { release({ ok: true }); });
        await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
    });
});

describe('endSessionOnServer', () => {
    it('reports whether the server ended the session', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        apiPut.mockResolvedValueOnce({ ok: true });
        expect(await endSessionOnServer(5)).toBe(true);
        apiPut.mockRejectedValueOnce(new Error('boom'));
        expect(await endSessionOnServer(5)).toBe(false);
        expect(await endSessionOnServer(null)).toBe(false);
        expect(apiPut).toHaveBeenCalledTimes(2);
    });
});
