import React, { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import PhysicalExamEditor from './PhysicalExamEditor.jsx';

const toast = {
    error: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useToast: () => toast,
    };
});

vi.mock('../examination/BodyMap', () => ({
    default: function BodyMapStub({ onRegionClick }) {
        return (
            <button type="button" onClick={() => onRegionClick('chest')}>
                select chest
            </button>
        );
    },
}));

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

function mount() {
    const captured = { current: null };
    function Harness() {
        const [caseData, setCaseData] = useState({ id: 'case-1', config: {} });
        useEffect(() => {
            captured.current = caseData;
        }, [caseData]);
        return (
            <PhysicalExamEditor
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
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ imageUrl: '/uploads/heart.wav' })
    );
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('PhysicalExamEditor apiFetch migration', () => {
    it('POSTs auscultation audio through apiFetch with bearer auth and FormData', async () => {
        const { captured } = mount();

        fireEvent.click(screen.getByRole('button', { name: /select chest/i }));
        const heartUploadLabel = await screen.findByText(/upload custom heart sound/i);
        const input = heartUploadLabel.closest('label').querySelector('input[type="file"]');
        const file = new File(['audio'], 'heart.wav', { type: 'audio/wav' });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledWith('/api/upload', expect.objectContaining({ method: 'POST' }));
        });

        const [, init] = fetchSpy.mock.calls.find(([url]) => url === '/api/upload');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
        expect(init.body).toBeInstanceOf(FormData);
        expect(init.body.get('photo')).toBe(file);

        await waitFor(() => {
            expect(captured.current.config.physical_exam.chest.auscultation.heartAudio).toBe('/uploads/heart.wav');
        });
    });

    it('surfaces an upload error toast when the API rejects the audio upload', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }));
        mount();

        fireEvent.click(screen.getByRole('button', { name: /select chest/i }));
        const heartUploadLabel = await screen.findByText(/upload custom heart sound/i);
        const input = heartUploadLabel.closest('label').querySelector('input[type="file"]');
        fireEvent.change(input, {
            target: { files: [new File(['audio'], 'heart.wav', { type: 'audio/wav' })] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to upload audio file'));
    });
});
