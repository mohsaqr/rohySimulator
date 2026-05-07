import React, { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import RadiologyEditor from './RadiologyEditor.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useToast: () => toast,
    };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

const study = {
    id: 11,
    name: 'Chest X-Ray',
    modality: 'X-Ray',
    body_region: 'Chest',
    turnaround_minutes: 15,
};

let fetchSpy;

function mount(initialRadiology = []) {
    const captured = { current: null };
    function Harness() {
        const [caseData, setCaseData] = useState({
            id: 'case-1',
            config: { radiology: initialRadiology },
        });
        useEffect(() => {
            captured.current = caseData;
        }, [caseData]);
        return (
            <RadiologyEditor
                caseData={caseData}
                setCaseData={(updater) => setCaseData(prev => typeof updater === 'function' ? updater(prev) : updater)}
            />
        );
    }

    const utils = renderWithProviders(
        <Harness />,
        { withAuth: false, withNotifications: false, withToast: false }
    );
    return { ...utils, captured };
}

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/radiology-database')) {
            return Promise.resolve(jsonResponse({ studies: [study], modalities: ['X-Ray'] }));
        }
        if (typeof url === 'string' && url.endsWith('/api/upload')) {
            return Promise.resolve(jsonResponse({ imageUrl: '/uploads/cxr.png' }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('RadiologyEditor apiFetch migration', () => {
    it('loads radiology studies with bearer auth and the correct path', async () => {
        mount();

        expect(await screen.findByText('Chest X-Ray')).toBeInTheDocument();

        const [url, init] = fetchSpy.mock.calls.find(([callUrl]) =>
            typeof callUrl === 'string' && callUrl.endsWith('/api/radiology-database')
        );
        expect(url).toBe('/api/radiology-database');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('POSTs uploaded result images as FormData and stores the returned URL', async () => {
        const { captured } = mount([{
            id: 1,
            studyId: 11,
            studyName: 'Chest X-Ray',
            modality: 'X-Ray',
            bodyRegion: 'Chest',
            turnaroundMinutes: 15,
            imageUrl: '',
            videoUrl: '',
            findings: '',
            interpretation: '',
        }]);

        await screen.findByText('Chest X-Ray');
        const uploadLabel = screen.getByText(/upload image/i);
        const input = uploadLabel.closest('label').querySelector('input[type="file"]');
        const file = new File(['png'], 'cxr.png', { type: 'image/png' });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(fetchSpy.mock.calls.some(([url, init]) => url === '/api/upload' && init?.method === 'POST')).toBe(true);
        });

        const [, init] = fetchSpy.mock.calls.find(([url, callInit]) => url === '/api/upload' && callInit?.method === 'POST');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
        expect(init.body).toBeInstanceOf(FormData);
        expect(init.body.get('photo')).toBe(file);

        await waitFor(() => {
            expect(captured.current.config.radiology[0].imageUrl).toBe('/uploads/cxr.png');
        });
        expect(toast.success).toHaveBeenCalledWith('Image uploaded successfully');
    });

    it('surfaces an API error toast when image upload fails', async () => {
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/radiology-database')) {
                return Promise.resolve(jsonResponse({ studies: [study], modalities: ['X-Ray'] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/upload')) {
                return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        mount([{
            id: 1,
            studyId: 11,
            studyName: 'Chest X-Ray',
            modality: 'X-Ray',
            bodyRegion: 'Chest',
            turnaroundMinutes: 15,
            imageUrl: '',
            videoUrl: '',
            findings: '',
            interpretation: '',
        }]);

        await screen.findByText('Chest X-Ray');
        const uploadLabel = screen.getByText(/upload image/i);
        const input = uploadLabel.closest('label').querySelector('input[type="file"]');
        fireEvent.change(input, {
            target: { files: [new File(['png'], 'cxr.png', { type: 'image/png' })] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('forbidden'));
    });
});
