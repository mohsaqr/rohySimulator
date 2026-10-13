// Case packages, client half (CasePackages.jsx + its ConfigPanel wiring).
//
// Locks: with the switch OFF the case list is exactly what it was (no new
// buttons); with it ON, Export starts a job and downloads the finished file by
// navigation, and Import uploads in the server's chunk size, in order, then
// shows the report the server returned.
import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import CasePackageSettings, { CasePackageExportButton, CasePackageImportButton } from './CasePackages.jsx';
import useCasePackages, { CASE_PACKAGES_CHANGED } from './useCasePackages.js';

// One stable toast, so a test can read what the JSON import reported.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('../../contexts/ToastContext', async (importActual) => ({ ...(await importActual()), useToast: () => toast }));
vi.mock('./AgentTemplateManager.jsx', () => ({ default: () => <div /> }));
vi.mock('./AvatarsSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./VoiceSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./NotificationsSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./ScenarioRepository.jsx', () => ({ default: () => <div /> }));
vi.mock('../analytics/OyonDataLogs.jsx', () => ({ default: () => <div /> }));
vi.mock('../analytics/tna/TnaDashboardV2.jsx', () => ({ default: () => <div /> }));

import ConfigPanel from './ConfigPanel.jsx';

const CASES = [{ id: 7, name: 'Chest pain', description: 'd', case_code: 'EN-0007', is_available: true, config: { case_language: 'en' } }];

let enabled = false;
const calls = [];
const server = setupServer(
    http.get('*/api/auth/verify', () => HttpResponse.json({ user: { id: 1, username: 'admin', role: 'admin' } })),
    http.get('*/api/cases', () => HttpResponse.json({ cases: CASES })),
    http.get('*/api/platform-settings/case-packages', () => HttpResponse.json({ enabled, max_bytes: 4 * 1024 ** 3, chunk_bytes: 4 })),
    http.post('*/api/cases/7/package', () => { calls.push('export'); return HttpResponse.json({ id: 'job-e', state: 'queued' }, { status: 202 }); }),
    http.get('*/api/case-packages/jobs/job-e', () => HttpResponse.json({
        id: 'job-e', kind: 'export', state: 'done',
        result: { bytes: 2048, counts: { uploads: 1, slides: 2, referenced: 1, lessons: 6 }, warnings: [] },
    })),
    http.post('*/api/case-packages/uploads', async ({ request }) => {
        calls.push(['create', (await request.json()).bytes]);
        return HttpResponse.json({ id: 'up-1', chunk_bytes: 4 }, { status: 201 });
    }),
    http.put('*/api/case-packages/uploads/up-1/chunks/:index', async ({ params, request }) => {
        calls.push(['chunk', Number(params.index), (await request.arrayBuffer()).byteLength, request.headers.get('content-type')]);
        return HttpResponse.json({ received: 0 });
    }),
    http.post('*/api/case-packages/uploads/up-1/complete', () => { calls.push('complete'); return HttpResponse.json({ id: 'job-i' }, { status: 202 }); }),
    http.get('*/api/case-packages/jobs/job-i', () => HttpResponse.json({
        id: 'job-i', kind: 'import', state: 'done',
        result: {
            case: { id: 9, case_code: 'EN-0009', name: 'Chest pain' },
            course: { id: 4, name: 'Patologia', lessons: 6, locked: 5 },
            imported: { agents: 2, investigations: 3, treatments: 1, uploads: 1, slides: 1, lessons: 6 },
            warnings: [{ field: 'config.pacs', received: 'remote:dicom/x/', hint: 'This study is not on this server.' }],
        },
    })),
    http.get('*/api/*', () => HttpResponse.json({})),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => server.close());
beforeEach(() => {
    calls.length = 0;
    enabled = false;
    Object.values(toast).forEach((fn) => fn.mockClear());
    window.localStorage.setItem('token', 'test-token');
});

describe('ConfigPanel case list with case packages', () => {
    it('shows no package buttons while the switch is off — the list is as it was', async () => {
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await screen.findByText('Chest pain');
        expect(screen.getByTitle('Export to JSON')).toBeInTheDocument();
        expect(screen.queryByText('Import package')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Export as a case package (case and media)')).not.toBeInTheDocument();
    });

    it('shows the buttons as soon as the switch is saved, without reopening Settings', async () => {
        // Regression lock: the case list read the switch once, when Settings opened, so turning it on showed no buttons until Settings was reopened (found in the two-server browser round trip, 2026-10-10)
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await screen.findByText('Chest pain');
        expect(screen.queryByText('Import package')).not.toBeInTheDocument();
        act(() => { window.dispatchEvent(new CustomEvent(CASE_PACKAGES_CHANGED, { detail: { enabled: true } })); });
        expect(await screen.findByText('Import package')).toBeInTheDocument();
    });

    it('adds Export package per case and Import package once the switch is on', async () => {
        enabled = true;
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        expect(await screen.findByText('Import package')).toBeInTheDocument();
        expect(screen.getByTitle('Export as a case package (case and media)')).toBeInTheDocument();
        // The JSON buttons are still there, unchanged.
        expect(screen.getByTitle('Export to JSON')).toBeInTheDocument();
    });
});

// Chrome's own NotReadableError text, verbatim from the Prova report.
const CHROME_TEXT = 'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.';

/** Make FileReader's `method` fail the way Chrome does for a file it cannot read. */
function failRead(method) {
    return vi.spyOn(FileReader.prototype, method).mockImplementation(function fail() {
        Object.defineProperty(this, 'error', { value: new DOMException(CHROME_TEXT, 'NotReadableError') });
        this.onerror?.();
    });
}

/** Click the JSON "Import" button and pick `file` in the input it opens. */
async function pickJsonImport(file) {
    let input;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function capture() { input = this; });
    fireEvent.click(await screen.findByTitle('Import Case from JSON'));
    expect(input?.accept).toBe('.json');
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { await input.onchange({ target: input }); });
}

describe('ConfigPanel JSON case import', () => {
    it('shows plain words, not Chrome\'s raw text, when the file cannot be read', async () => {
        // Regression lock: FI0010.AUTHOR.03 raw NotReadableError shown on case import
        failRead('readAsText');
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await screen.findByText('Chest pain');
        await pickJsonImport(new File(['{"name":"x","description":"y"}'], 'case-x.json'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
        const [shown] = toast.error.mock.calls[0];
        expect(shown).toMatch(/^Failed to import case: The file could not be read\. If it is in OneDrive or Dropbox/);
        expect(shown).not.toMatch(/permission problems/);
    });

    it('sends a case package to Import package — and says how to turn packages on when they are off', async () => {
        // FI0010.AUTHOR.03: the 2.98 GB FI-0017 package was picked in the JSON
        // importer, which read it whole as text — what Chrome refused.
        const posted = vi.fn();
        server.use(http.post('*/api/cases', () => { posted(); return HttpResponse.json({}); }));
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await screen.findByText('Chest pain');
        await pickJsonImport(new File(['not read'], 'case-FI-0017.rohycase'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
            'Failed to import case: This is a case package (.rohycase). Turn on Allow case packages in Settings → Platform → General, then import it with Import package.',
        ));
        expect(posted).not.toHaveBeenCalled();
    });

    it('with packages on, points at the Import package button', async () => {
        enabled = true;
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await screen.findByText('Import package');
        await pickJsonImport(new File(['not read'], 'case-FI-0017.rohycase'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
            'Failed to import case: This is a case package (.rohycase). Import it with Import package.',
        ));
    });

    it('still imports an ordinary JSON case', async () => {
        const bodies = [];
        server.use(http.post('*/api/cases', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ id: 8 }); }));
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await screen.findByText('Chest pain');
        await pickJsonImport(new File([JSON.stringify({ name: 'Imported', description: 'd', config: { pages: [] } })], 'case-imported.json'));
        await waitFor(() => expect(bodies).toEqual([{ name: 'Imported', description: 'd', config: { pages: [] } }]));
        await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
        expect(toast.error).not.toHaveBeenCalled();
    });
});

describe('CasePackageExportButton', () => {
    it('starts the job, downloads the finished package by navigation, and summarises it', async () => {
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        renderWithProviders(<CasePackageExportButton caseItem={CASES[0]} />);
        fireEvent.click(screen.getByTitle('Export as a case package (case and media)'));
        await waitFor(() => expect(anchorClick).toHaveBeenCalled());
        expect(calls).toEqual(['export']);
        expect(anchorClick.mock.contexts[0].getAttribute('href')).toBe('/api/case-packages/jobs/job-e/download');
        expect(await screen.findByText(/Package ready \(2 KB\)/)).toBeInTheDocument();
        expect(screen.getByText(/Carried: 1 media file and 2 slides/)).toBeInTheDocument();
        expect(screen.getByText(/Course: 6 lessons\./)).toBeInTheDocument();
    });
});

describe('CasePackageImportButton', () => {
    it('uploads in the server chunk size, in order, completes, and shows the report', async () => {
        const onImported = vi.fn();
        renderWithProviders(<CasePackageImportButton onImported={onImported} />);
        fireEvent.click(screen.getByText('Import package'));
        const file = new File(['0123456789'], 'case.rohycase'); // 10 bytes → chunks of 4, 4, 2
        fireEvent.change(screen.getByLabelText('Choose a .rohycase file'), { target: { files: [file] } });

        expect(await screen.findByText(/Imported as a new case: Chest pain \(EN-0009\)/)).toBeInTheDocument();
        expect(screen.getByText(/Course “Patologia” created with 6 lessons\. Add its learners in Courses\./)).toBeInTheDocument();
        expect(calls).toEqual([
            ['create', 10],
            ['chunk', 0, 4, 'application/octet-stream'],
            ['chunk', 1, 4, 'application/octet-stream'],
            ['chunk', 2, 2, 'application/octet-stream'],
            'complete',
        ]);
        expect(screen.getByText('1 note')).toBeInTheDocument();
        expect(screen.getByText('remote:dicom/x/')).toBeInTheDocument();
        expect(onImported).toHaveBeenCalledTimes(1);
    });

    it('says the file could not be read — not "Failed to fetch", and without retrying — when a chunk read fails', async () => {
        // Regression lock: FI0010.AUTHOR.03 raw NotReadableError shown on case import
        // (here it surfaced as a network error, retried three times, because the
        // unreadable Blob went straight into fetch's body).
        failRead('readAsArrayBuffer');
        renderWithProviders(<CasePackageImportButton onImported={() => {}} />);
        fireEvent.click(screen.getByText('Import package'));
        fireEvent.change(screen.getByLabelText('Choose a .rohycase file'), { target: { files: [new File(['0123456789'], 'case.rohycase')] } });

        expect(await screen.findByRole('alert')).toHaveTextContent(/^Failed: The file could not be read\. If it is in OneDrive or Dropbox/);
        expect(screen.getByRole('alert')).not.toHaveTextContent(/permission problems/);
        expect(calls).toEqual([['create', 10]]);
    });
});

describe('CasePackageSettings', () => {
    it('loads once even when the load fails — a failed load must not loop', async () => {
        // Regression lock: the load effect was keyed on the toast context, which is rebuilt on every notification — a failed load toasted, re-ran, failed, toasted: 21 requests with nobody clicking (Codex review, 2026-10-10)
        let requests = 0;
        server.use(http.get('*/api/platform-settings/case-packages', () => {
            requests += 1;
            return HttpResponse.json({ error: 'boom' }, { status: 500 });
        }));
        renderWithProviders(<CasePackageSettings />);
        expect(await screen.findByRole('alert')).toHaveTextContent('boom');
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(requests).toBe(1);
    });

    it('ticking the switch shows the package buttons wherever the hook is mounted', async () => {
        let saved = false;
        server.use(
            http.get('*/api/platform-settings/case-packages', () => HttpResponse.json({ enabled: saved, max_bytes: 1, chunk_bytes: 1 })),
            http.put('*/api/platform-settings/case-packages', async ({ request }) => {
                saved = (await request.json()).enabled;
                return HttpResponse.json({ enabled: saved, max_bytes: 1, chunk_bytes: 1 });
            }),
        );
        function Probe() {
            return <span>{useCasePackages(true) ? 'packages on' : 'packages off'}</span>;
        }
        renderWithProviders(<><CasePackageSettings /><Probe /></>);
        expect(await screen.findByText('packages off')).toBeInTheDocument();
        fireEvent.click(await screen.findByLabelText('Allow case packages'));
        expect(await screen.findByText('packages on')).toBeInTheDocument();
    });
});
