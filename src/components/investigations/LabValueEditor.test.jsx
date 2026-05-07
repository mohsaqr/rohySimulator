import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import LabValueEditor from './LabValueEditor.jsx';

// Audit #14: focused integration test for the lab value editor — one of
// the high-impact instructor controls the audit flagged as untested. The
// component is on apiFetch (after audit #1), so we mock global fetch.

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

// renderWithProviders mounts AuthProvider + NotificationProvider which fire
// their own /api/auth/verify and /api/notification-prefs requests on mount.
// Helper: filter the spy's call list down to ones that hit the lab path
// so assertions describe only the unit under test.
function labFetchCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
        typeof url === 'string' && /\/sessions\/\d+\/(available-labs|labs\/)/.test(url)
    );
}

beforeEach(() => {
    localStorage.setItem('token', 'instructor-token');
    // Default: every unrelated fetch (auth, notification prefs, ...) gets
    // a benign 200 with empty JSON so the providers don't error and pollute
    // the test output. Tests stage their own lab-specific responses on top.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }))
    );
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
});

describe('LabValueEditor', () => {
    it('fetches available labs for the session with bearer auth', async () => {
        // Stage the lab-specific response. Other fetches (auth, prefs)
        // continue to use the benign-200 default from beforeEach.
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.includes('/available-labs')) {
                return Promise.resolve(jsonResponse({
                    labs: [
                        { id: 1, test_name: 'Sodium', current_value: 140, min_value: 135, max_value: 145, unit: 'mEq/L', is_abnormal: false },
                        { id: 2, test_name: 'Potassium', current_value: 4.0, min_value: 3.5, max_value: 5.0, unit: 'mEq/L', is_abnormal: false },
                    ],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<LabValueEditor sessionId={42} caseId={7} />);

        expect(await screen.findByText(/Sodium/)).toBeInTheDocument();
        expect(screen.getByText(/Potassium/)).toBeInTheDocument();

        const calls = labFetchCalls();
        expect(calls).toHaveLength(1);
        const [url, init] = calls[0];
        expect(url).toBe('/api/sessions/42/available-labs');
        expect(init.headers.Authorization).toBe('Bearer instructor-token');
        // Bodyless GET — apiFetch must NOT set Content-Type.
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('PUTs the updated value when an instructor changes a lab', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.includes('/available-labs')) {
                return Promise.resolve(jsonResponse({
                    labs: [{
                        id: 5,
                        test_name: 'Hemoglobin',
                        current_value: 14.0,
                        min_value: 13.0,
                        max_value: 17.0,
                        unit: 'g/dL',
                        is_abnormal: false,
                    }],
                }));
            }
            if (typeof url === 'string' && url.match(/\/labs\/\d+$/) && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ ok: true }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<LabValueEditor sessionId={42} caseId={7} />);
        await screen.findByText(/Hemoglobin/);

        fireEvent.click(screen.getByText(/Hemoglobin/));

        const input = await screen.findByDisplayValue('14');
        fireEvent.change(input, { target: { value: '7.5' } });

        const saveBtn = await screen.findByRole('button', { name: /save/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(labFetchCalls().length).toBeGreaterThanOrEqual(2);
        });

        const putCall = labFetchCalls().find(([, init]) => init?.method === 'PUT');
        expect(putCall).toBeTruthy();
        const [putUrl, putInit] = putCall;
        expect(putUrl).toBe('/api/sessions/42/labs/5');
        expect(putInit.headers.Authorization).toBe('Bearer instructor-token');
        expect(putInit.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(putInit.body)).toEqual({ current_value: 7.5 });
    });

    it('does not crash when the labs fetch fails — surfaces nothing visible to the user', async () => {
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.includes('/available-labs')) {
                return Promise.resolve(jsonResponse({ error: 'access denied' }, { status: 403 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<LabValueEditor sessionId={42} caseId={7} />);

        await waitFor(() => expect(labFetchCalls().length).toBeGreaterThanOrEqual(1));
        expect(screen.queryByText(/Sodium/)).toBeNull();
    });

    it('does nothing when sessionId is null', () => {
        renderWithProviders(<LabValueEditor sessionId={null} caseId={7} />);
        // Provider-driven fetches may fire, but the lab path must NOT.
        expect(labFetchCalls()).toEqual([]);
    });
});
