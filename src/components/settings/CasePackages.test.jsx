// Case packages, client half (CasePackages.jsx + its ConfigPanel wiring).
//
// Locks: with the switch OFF the case list is exactly what it was (no new
// buttons); with it ON, Export starts a job and downloads the finished file by
// navigation, and Import uploads in the server's chunk size, in order, then
// shows the report the server returned.
import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import CasePackageSettings, { CasePackageExportButton, CasePackageImportButton } from './CasePackages.jsx';
import useCasePackages, { CASE_PACKAGES_CHANGED } from './useCasePackages.js';
import { formatBytes, formatElapsed } from './casePackageFormat.js';

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
        expect(await screen.findByText(/Package ready \(2 KiB\)/)).toBeInTheDocument();
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
        expect(screen.getByText('The course “Patologia” has no members yet. Add learners or a join code in Courses.')).toBeInTheDocument();
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

// FI-0010 journey review (2026-10-14): a 3 GB package's import sat at one
// phase line for minutes, Cancel could not stop it, and the summary did not
// say the new case was hidden or the course empty.
describe('CasePackageImportButton — a long import', () => {
    const RUNNING = {
        id: 'job-i', kind: 'import', state: 'running', phase: 'checking', cancellable: true, cancel_requested: false,
        elapsed_ms: 187000,
        progress: { done: 12340, total: 71200, bytes_done: 512 * 1024 ** 2, bytes_total: 2.8 * 1024 ** 3 },
    };
    const RESULT = {
        case: { id: 9, case_code: 'FI-0011', name: 'Pentti', is_available: false },
        course: { id: 4, name: 'Patologia (FI-0011)', source_name: 'Patologia (FI-0010)', lessons: 6, locked: 5, published: 6, members: 0 },
        imported: { agents: 3, investigations: 0, treatments: 0, uploads: 0, slides: 4, lessons: 6 },
        media: { uploads_reused: 0, uploads_copied: 0, slides_reused: 4, slides_copied: 0, files_copied: 0, bytes_copied: 0 },
        warnings: [],
    };
    let job;
    let cancelAnswer;
    let listed;
    const posted = [];

    beforeEach(() => {
        job = { ...RUNNING };
        cancelAnswer = null;
        listed = [];
        posted.length = 0;
        window.localStorage.removeItem('rohy.casePackages.detachedJobs');
        server.use(
            http.get('*/api/case-packages/jobs/job-i', () => HttpResponse.json(job)),
            http.get('*/api/case-packages/jobs', () => HttpResponse.json({ jobs: listed })),
            http.post('*/api/case-packages/jobs/job-i/cancel', () => {
                posted.push('cancel');
                if (cancelAnswer) return HttpResponse.json(cancelAnswer.body, { status: cancelAnswer.status });
                job = { ...job, cancel_requested: true };
                return HttpResponse.json(job, { status: 202 });
            }),
            http.put('*/api/cases/9/availability', async ({ request }) => {
                posted.push(['availability', await request.json()]);
                return HttpResponse.json({ success: true });
            }),
        );
    });

    async function startImport(props = {}) {
        renderWithProviders(<CasePackageImportButton onImported={() => {}} {...props} />);
        fireEvent.click(screen.getByText('Import package'));
        fireEvent.change(screen.getByLabelText('Choose a .rohycase file'), { target: { files: [new File(['0123456789'], 'case.rohycase')] } });
    }

    it('shows files, bytes and time within the phase, not only the phase name', async () => {
        // Regression lock: F04 the job status carried no done/total, so "Checking media against this server…" looked stalled for 10–60 minutes
        await startImport();
        expect(await screen.findByText('Checking media against this server…')).toBeInTheDocument();
        expect(screen.getByText('12,340 / 71,200 files · 512 MiB of 2.8 GiB · 3:07 elapsed')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('max', '71200');
    });

    it('Cancel import stops the job on the server, and the dialog says nothing was created', async () => {
        // Regression lock: F05 Cancel after the upload only closed the dialog; the job ran on and could still create the case and course
        await startImport();
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }));
        await waitFor(() => expect(posted).toEqual(['cancel']));
        expect(await screen.findByText('Cancelling… removing what the import had placed.')).toBeInTheDocument();
        job = { ...job, state: 'cancelled', cancellable: false, error: { code: 'case_package_cancelled' } };
        expect(await screen.findByText('Import cancelled. Nothing was created, and the files it had placed were removed.', {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it('says Close does not stop the import, and offers the running import again once closed', async () => {
        // Regression lock: F05 a closed dialog left no trace of the running import, so the admin retried and made a duplicate course
        await startImport();
        expect(await screen.findByText(/Closing this window does not stop the import/)).toBeInTheDocument();
        listed = [job];
        fireEvent.click(screen.getAllByRole('button', { name: 'Close — the import continues' }).at(-1));
        expect(posted).toEqual([]); // closing is not cancelling
        expect(await screen.findByRole('button', { name: 'Import running — show' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Import running — show' }));
        expect(await screen.findByText('12,340 / 71,200 files · 512 MiB of 2.8 GiB · 3:07 elapsed')).toBeInTheDocument();
    });

    it('finds a running import when the case list is opened again', async () => {
        listed = [job];
        renderWithProviders(<CasePackageImportButton onImported={() => {}} />);
        expect(await screen.findByRole('button', { name: 'Import running — show' })).toBeInTheDocument();
        fireEvent.click(screen.getByText('Import package'));
        expect(screen.getByText(/An import you started is still running/)).toBeInTheDocument();
    });

    it('says when it is too late to cancel, and then shows the finished import', async () => {
        cancelAnswer = { status: 409, body: { error: 'The case has already been saved', code: 'case_package_committed' } };
        await startImport();
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }));
        expect(await screen.findByText('Too late to cancel: the case has already been saved. The import is finishing.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel import' })).not.toBeInTheDocument();
        job = { ...job, state: 'done', cancellable: false, result: RESULT };
        expect(await screen.findByText(/Imported as a new case: Pentti \(FI-0011\)/, {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it('ends with what makes the case playable: show it, add course members, the locked lessons', async () => {
        // Regression lock: F22 the summary did not say the case starts hidden and the course has no members
        const onOpenCourses = vi.fn();
        const onImported = vi.fn();
        job = { ...job, state: 'done', cancellable: false, result: RESULT };
        await startImport({ onOpenCourses, onOpenLessons: () => {}, onImported });
        expect(await screen.findByText('Next steps')).toBeInTheDocument();
        expect(screen.getByText('The case FI-0011 is hidden: learners do not see it yet.')).toBeInTheDocument();
        expect(screen.getByText('The course “Patologia (FI-0011)” has no members yet. Add learners or a join code in Courses.')).toBeInTheDocument();
        expect(screen.getByText(/the package called it “Patologia \(FI-0010\)”/)).toBeInTheDocument();
        expect(screen.getByText('6 lessons; 5 open only after the learner has played the case.')).toBeInTheDocument();
        expect(screen.getByText('Already on this server: 4 slides, 0 media files. Copied: 0 slides, 0 media files.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show to learners' }));
        expect(await screen.findByText('The case FI-0011 is visible to learners.')).toBeInTheDocument();
        expect(posted).toEqual([['availability', { is_available: true }]]);
        expect(onImported).toHaveBeenCalledTimes(2); // once on import, once when shown

        fireEvent.click(screen.getByRole('button', { name: 'Open Courses' }));
        expect(onOpenCourses).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('the package dialog and the keyboard', () => {
    it('takes focus, keeps Tab inside, closes on Escape and gives focus back', async () => {
        // Regression lock: F17 the dialog had aria-modal but no initial focus, focus trap, Escape or focus restore
        renderWithProviders(<><button type="button">Behind</button><CasePackageImportButton onImported={() => {}} /></>);
        const opener = screen.getByText('Import package').closest('button');
        opener.focus();
        fireEvent.click(opener);
        const dialog = screen.getByRole('dialog');
        const input = screen.getByLabelText('Choose a .rohycase file');
        expect(input).toHaveFocus();

        // Tab past the last control wraps to the first; Shift+Tab before the first wraps to the last.
        const buttons = within(dialog).getAllByRole('button');
        const [first, last] = [buttons[0], buttons[buttons.length - 1]];
        last.focus();
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(first).toHaveFocus();
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();

        fireEvent.keyDown(document.activeElement, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });
});

describe('sizes in the UI language', () => {
    it('formats bytes with the language\'s decimal mark and binary units', () => {
        // Regression lock: F16 "2.8 GB" was hard-coded English: decimal point and a GB that was really GiB
        expect(formatBytes(2.8 * 1024 ** 3, 'fi')).toBe('2,8 GiB');
        expect(formatBytes(2.8 * 1024 ** 3, 'en')).toBe('2.8 GiB');
        expect(formatBytes(4 * 1024 ** 3, 'de')).toBe('4 GiB');
        expect(formatBytes(1536 * 1024, 'sv')).toBe('1,5 MiB');
        expect(formatBytes(10, 'en')).toBe('1 KiB');
        expect(formatBytes(Number.NaN, 'en')).toBe('');
        expect(formatElapsed(187000)).toBe('3:07');
        expect(formatElapsed(3 * 3600 * 1000 + 5000)).toBe('3:00:05');
    });
});
