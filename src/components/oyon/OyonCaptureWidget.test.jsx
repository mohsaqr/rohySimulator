import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import OyonCaptureWidget from './OyonCaptureWidget.jsx';

const mocks = vi.hoisted(() => ({
    apiFetch: vi.fn(),
    loadOyonElement: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
    apiFetch: (...args) => mocks.apiFetch(...args),
}));

vi.mock('./loadOyonElement', () => ({
    loadOyonElement: (...args) => mocks.loadOyonElement(...args),
}));

vi.mock('./screenAois', () => ({
    getAois: () => [],
    onAois: () => () => {},
}));

vi.mock('./clientLogger', () => ({
    oyonClientLog: vi.fn(),
}));

function apiCalls(path) {
    return mocks.apiFetch.mock.calls.filter(([url]) => url === path);
}

describe('OyonCaptureWidget persistence gate', () => {
    beforeEach(() => {
        mocks.loadOyonElement.mockResolvedValue(undefined);
        mocks.apiFetch.mockImplementation((url) => {
            if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, runtime: {} });
            if (url === '/addons/oyon/consent') return Promise.resolve({});
            if (url === '/addons/oyon/emotion-records') return Promise.resolve({});
            return Promise.resolve({});
        });
        localStorage.setItem('oyon.defaultConsent', '1');
    });

    afterEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('opens persistence when a session id appears after capture is already running', async () => {
        const { container, rerender } = render(
            <OyonCaptureWidget sessionId={null} caseId="case-1" room="chat" />,
        );

        await waitFor(() => expect(mocks.loadOyonElement).toHaveBeenCalled());
        const el = container.querySelector('oyon-app');
        expect(el).toBeTruthy();

        await act(async () => {
            el.dispatchEvent(new CustomEvent('oyon:status', { detail: { state: 'running' } }));
        });
        expect(apiCalls('/addons/oyon/consent')).toHaveLength(0);

        rerender(<OyonCaptureWidget sessionId="s-1" caseId="case-1" room="consultant" />);
        await waitFor(() => expect(apiCalls('/addons/oyon/consent')).toHaveLength(1));

        await act(async () => {
            el.dispatchEvent(new CustomEvent('oyon:window', {
                detail: { windows: [{ record_id: 'w-1', dominant_emotion: 'neutral' }] },
            }));
        });

        await waitFor(() => expect(apiCalls('/addons/oyon/emotion-records')).toHaveLength(1));
        const [, request] = apiCalls('/addons/oyon/emotion-records')[0];
        expect(request.json.session_id).toBe('s-1');
        expect(request.json.events[0].room).toBe('consultant');
    });
});
