// Regression lock: case versions were kept on every save but no UI could list or restore them (QA 2026-10-04, PRV-27)
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import CaseVersionHistory from './CaseVersionHistory.jsx';

const restoreCalls = [];
const server = setupServer(
    http.get('*/api/cases/7/versions', () => HttpResponse.json({
        versions: [
            { id: 31, version_number: 3, change_timestamp: '2026-10-04 09:00', changed_by_username: 'admin', change_type: 'update' },
            { id: 30, version_number: 2, change_timestamp: '2026-10-03 18:00', changed_by_username: 'admin', change_type: 'update' },
        ],
    })),
    http.post('*/api/cases/7/restore/:versionId', ({ params }) => {
        restoreCalls.push(params.versionId);
        return HttpResponse.json({ message: 'Case restored' });
    }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => { server.resetHandlers(); restoreCalls.length = 0; });
afterAll(() => server.close());

describe('CaseVersionHistory', () => {
    it('lists versions newest first and restores one only after a second, explicit click', async () => {
        const onRestored = vi.fn();
        renderWithProviders(
            <CaseVersionHistory caseId={7} caseName="STEMI teaching case" onClose={() => {}} onRestored={onRestored} />,
            {},
        );
        expect(await screen.findByText('Version 3')).toBeInTheDocument();
        expect(screen.getByText('Version 2')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: /^Restore$/ })[1]);
        // First click only asks.
        expect(restoreCalls).toEqual([]);
        expect(screen.getByText(/Replace the current case with this version\?/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Restore it' }));
        await waitFor(() => expect(restoreCalls).toEqual(['30']));
        await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    });

    it('closes on Escape', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <CaseVersionHistory caseId={7} caseName="x" onClose={onClose} />,
            {},
        );
        await screen.findByText('Version 3');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
