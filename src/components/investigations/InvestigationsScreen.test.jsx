// Contract for InvestigationsScreen — the full-page workspace that
// replaces the old OrdersDrawer + LabResultsModal + RadiologyResultsModal
// flow when ordering labs/radiology and viewing results.
//
// We stub the catalogue + worklist + report views so this test stays
// focused on the screen's own contract:
//   1. Topbar shows the modality title (Laboratory or Radiology) + case
//      name + Notes button. There is no topbar Back button — the
//      always-visible bottom RoomNavigator is the canonical exit, and
//      the inline DepartmentSignage + MiniSwitcher + [/] hotkeys were
//      removed because they duplicated the nav.
//   2. `activeKind` prop drives the active modality. Lab and Radiology
//      are peer rooms in the parent's RoomNavigator; this screen is the
//      same workspace mounted with a different prop.
//   3. Catalogue + Worklist mount with the right `kind`.
//   4. Selecting a ready order from the worklist renders the matching
//      report view in the right pane with the result piped through.
//   5. Notes drawer is hidden on mount, opens on Notes click, closes
//      on its onClose.
//   6. Submitting an order POSTs to /order-labs with `room: 'lab'` so
//      the server-side learning_events INSERT can stamp the room.
//
// Side effects (mark-as-viewed, PatientRecord.elicited) live in the
// report views themselves and are tested at that level.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// --- API mocks ----------------------------------------------------------
const apiFetch = vi.fn();
const apiPost = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiFetch: (...a) => apiFetch(...a),
    apiPost: (...a) => apiPost(...a),
    ApiError: class ApiError extends Error {},
}));

// --- Toast + PatientRecord mocks ---------------------------------------
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
    useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}));
const ordered = vi.fn();
vi.mock('../../services/PatientRecord', () => ({
    usePatientRecord: () => ({ ordered, elicited: vi.fn() }),
}));

// --- EventLogger mock --------------------------------------------------
const componentOpened = vi.fn();
const componentClosed = vi.fn();
vi.mock('../../services/eventLogger', () => ({
    default: {
        componentOpened: (...a) => componentOpened(...a),
        componentClosed: (...a) => componentClosed(...a),
    },
    COMPONENTS: { ORDERS_DRAWER: 'OrdersDrawer' },
}));

// --- Display-component stubs -------------------------------------------
vi.mock('./InvestigationCatalogue', () => ({
    default: function CatalogueStub(props) {
        return (
            <div
                data-testid="catalogue-stub"
                data-kind={props.kind}
                data-item-count={String(props.items?.length ?? 0)}
                data-selected-count={String(props.selectedIds?.length ?? 0)}
            >
                <button type="button" onClick={() => props.onToggleSelect(props.items[0]?.id)}>
                    toggle-first
                </button>
                <button type="button" onClick={() => props.onSubmit()}>submit-stub</button>
                {props.onSubmitInstant && (
                    <button type="button" onClick={() => props.onSubmitInstant()}>submit-instant-stub</button>
                )}
            </div>
        );
    },
}));
vi.mock('./InvestigationWorklist', () => ({
    default: function WorklistStub({ orders, openOrderIds, onSelectOrder, kind }) {
        const openCount = openOrderIds?.size ?? 0;
        return (
            <div data-testid="worklist-stub" data-kind={kind} data-orders={orders.length} data-open-count={openCount}>
                {orders.map((o) => (
                    <button
                        key={o.id}
                        type="button"
                        data-open={openOrderIds?.has?.(o.id) ? 'true' : 'false'}
                        onClick={() => onSelectOrder(o)}
                    >
                        worklist-row-{o.id}
                    </button>
                ))}
            </div>
        );
    },
}));
vi.mock('./LabReportView', () => ({
    default: function LabReportStub({ result, onClose }) {
        return (
            <div data-testid="lab-report-stub" data-result-id={result.order_id ?? result.id}>
                {onClose && (
                    <button type="button" onClick={onClose}>close-lab-{result.order_id ?? result.id}</button>
                )}
            </div>
        );
    },
}));
vi.mock('./RadiologyReportView', () => ({
    default: function RadiologyReportStub({ result, onClose }) {
        return (
            <div data-testid="radiology-report-stub" data-result-id={result.id}>
                {onClose && (
                    <button type="button" onClick={onClose}>close-rad-{result.id}</button>
                )}
            </div>
        );
    },
}));
vi.mock('../common/SessionNotesDrawer', () => ({
    default: function NotesDrawerStub({ open, onClose, sessionId, title }) {
        if (!open) return null;
        return (
            <div data-testid="notes-drawer" data-session-id={sessionId} data-title={title}>
                <button type="button" onClick={onClose}>close-notes</button>
            </div>
        );
    },
}));

import InvestigationsScreen from './InvestigationsScreen';

const baseCase = {
    id: 11,
    name: 'Acute Chest Pain - STEMI',
    config: { patient_name: 'John Q. Patient', demographics: { age: 55, gender: 'male' } },
};
const basePatientInfo = { name: 'John Q. Patient', age: 55, gender: 'male' };

function setupApi({ labs = [], labOrders = [], studies = [], radOrders = [] } = {}) {
    apiFetch.mockImplementation((path) => {
        if (path.endsWith('/available-labs')) return Promise.resolve({ labs });
        if (path.endsWith('/orders')) return Promise.resolve({ orders: labOrders });
        if (path.endsWith('/available-radiology')) return Promise.resolve({ studies, groups: ['CT', 'XR'] });
        if (path.endsWith('/radiology-orders')) return Promise.resolve({ orders: radOrders });
        return Promise.resolve({});
    });
}

async function renderScreen(overrides = {}) {
    setupApi(overrides.apiData || {});
    const utils = render(
        <InvestigationsScreen
            activeCase={overrides.activeCase ?? baseCase}
            sessionId={overrides.sessionId ?? 'sess-1'}
            patientInfo={overrides.patientInfo ?? basePatientInfo}
            activeKind={overrides.activeKind ?? 'lab'}
        />
    );
    // Let initial catalogue + orders fetches settle.
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    return utils;
}

beforeEach(() => {
    apiFetch.mockReset();
    apiPost.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
    ordered.mockClear();
    componentOpened.mockClear();
    componentClosed.mockClear();
});
afterEach(() => cleanup());

describe('InvestigationsScreen — topbar', () => {
    function headerOf(container) {
        // Both the topbar and the empty-state DepartmentDashboard render
        // the modality label; assertions scope to the topbar's <header>.
        return container.querySelector('header');
    }

    it('renders the Laboratory title and case name when activeKind=lab', async () => {
        const { container } = await renderScreen();
        const header = headerOf(container);
        expect(header).toBeTruthy();
        expect(header.textContent).toMatch(/Laboratory Investigations/);
        expect(header.textContent).toMatch(/Acute Chest Pain - STEMI/);
    });

    it('renders the Radiology title when activeKind=radiology', async () => {
        const { container } = await renderScreen({ activeKind: 'radiology' });
        const header = headerOf(container);
        expect(header.textContent).toMatch(/Radiology Room/);
    });

    it('does not render a topbar Back button (RoomNavigator owns exit)', async () => {
        await renderScreen();
        expect(screen.queryByRole('button', { name: /^Back$/ })).toBeNull();
    });

    it('does not render the inline modality switcher / [ ] hotkey hint', async () => {
        await renderScreen();
        // The inline DepartmentSignage + MiniSwitcher used to render a
        // "Switch room" affordance and a [/] keyboard hint inside the
        // screen. Both were retired; the bottom RoomNavigator is the
        // only Lab ↔ Radiology surface now.
        expect(screen.queryByText(/Switch room/i)).toBeNull();
    });
});

describe('InvestigationsScreen — activeKind drives the modality', () => {
    it('mounts the catalogue + worklist with kind=lab when activeKind=lab', async () => {
        await renderScreen({ apiData: { labs: [{ id: 1, test_name: 'CBC', test_group: 'Hematology' }] } });
        await waitFor(() => {
            expect(screen.getByTestId('catalogue-stub').getAttribute('data-kind')).toBe('lab');
        });
        expect(screen.getByTestId('worklist-stub').getAttribute('data-kind')).toBe('lab');
    });

    it('mounts the catalogue + worklist with kind=radiology when activeKind=radiology', async () => {
        await renderScreen({
            activeKind: 'radiology',
            apiData: {
                studies: [{ id: 7, name: 'CT Head', modality: 'CT', turnaround_minutes: 30 }],
            },
        });
        await waitFor(() => {
            expect(screen.getByTestId('catalogue-stub').getAttribute('data-kind')).toBe('radiology');
        });
        expect(screen.getByTestId('worklist-stub').getAttribute('data-kind')).toBe('radiology');
    });

    it('keyboard [ and ] no longer switch modalities (hotkeys retired)', async () => {
        await renderScreen({ apiData: { labs: [{ id: 1, test_name: 'CBC', test_group: 'Hematology' }] } });
        fireEvent.keyDown(window, { key: ']' });
        // Stays on lab because activeKind is a prop, not internal state.
        expect(screen.getByTestId('catalogue-stub').getAttribute('data-kind')).toBe('lab');
    });
});

describe('InvestigationsScreen — worklist → viewer wiring', () => {
    it('renders the department dashboard when no report is open', async () => {
        await renderScreen();
        // The empty-state hero stays visible until the student opens
        // their first result. Assert the stable "Welcome to" label.
        expect(screen.getByText(/Welcome to/)).toBeTruthy();
    });

    // Helper: locate a pill body (the clickable label, not the X) by test name.
    function pillBody(name) {
        const span = screen.getByText(name);
        return span.closest('button');
    }

    it('clicking a ready lab order adds a pill (no full report until pill is clicked)', async () => {
        await renderScreen({
            apiData: {
                labOrders: [{ id: 100, order_id: 100, test_name: 'Glucose', is_ready: 1, viewed_at: null }],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-100')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-100'));
        // Pill is present, no expanded report yet.
        expect(screen.getByText('Glucose')).toBeTruthy();
        expect(screen.queryByTestId('lab-report-stub')).toBeNull();
        // Clicking the pill expands the report.
        fireEvent.click(pillBody('Glucose'));
        const report = await screen.findByTestId('lab-report-stub');
        expect(report.getAttribute('data-result-id')).toBe('100');
    });

    it('clicking a ready radiology order adds a pill that expands on click', async () => {
        await renderScreen({
            activeKind: 'radiology',
            apiData: {
                radOrders: [{ id: 33, test_name: 'CXR PA', modality: 'XR', is_ready: 1, viewed_at: null }],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-33')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-33'));
        expect(screen.getByText('CXR PA')).toBeTruthy();
        fireEvent.click(pillBody('CXR PA'));
        const report = await screen.findByTestId('radiology-report-stub');
        expect(report.getAttribute('data-result-id')).toBe('33');
    });

    it('stacks multiple viewed reports as pills (newest on top)', async () => {
        await renderScreen({
            apiData: {
                labOrders: [
                    { id: 100, order_id: 100, test_name: 'Glucose',    is_ready: 1, viewed_at: null },
                    { id: 200, order_id: 200, test_name: 'Sodium',     is_ready: 1, viewed_at: null },
                    { id: 300, order_id: 300, test_name: 'Potassium',  is_ready: 1, viewed_at: null },
                ],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-100')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-100'));
        fireEvent.click(screen.getByText('worklist-row-200'));
        fireEvent.click(screen.getByText('worklist-row-300'));
        // All three pills present, no expanded report (pure pill mode).
        expect(screen.getByText('Glucose')).toBeTruthy();
        expect(screen.getByText('Sodium')).toBeTruthy();
        expect(screen.getByText('Potassium')).toBeTruthy();
        expect(screen.queryByTestId('lab-report-stub')).toBeNull();
    });

    it('opening a pill replaces the welcome+pills with the full report; closing it returns to the pill stack', async () => {
        await renderScreen({
            apiData: {
                labOrders: [
                    { id: 100, order_id: 100, test_name: 'Glucose', is_ready: 1, viewed_at: null },
                    { id: 200, order_id: 200, test_name: 'Sodium',  is_ready: 1, viewed_at: null },
                ],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-100')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-100'));
        fireEvent.click(screen.getByText('worklist-row-200'));
        // Two pills visible alongside the welcome card.
        expect(screen.getByText(/Welcome to/)).toBeTruthy();
        expect(screen.getByText('Glucose')).toBeTruthy();
        expect(screen.getByText('Sodium')).toBeTruthy();
        // Open Sodium → welcome + pills hide, full report shows.
        fireEvent.click(pillBody('Sodium'));
        let reports = screen.getAllByTestId('lab-report-stub');
        expect(reports).toHaveLength(1);
        expect(reports[0].getAttribute('data-result-id')).toBe('200');
        expect(screen.queryByText(/Welcome to/)).toBeNull();
        // Close the report → back to stack view.
        fireEvent.click(screen.getByText('close-lab-200'));
        expect(screen.queryByTestId('lab-report-stub')).toBeNull();
        expect(screen.getByText(/Welcome to/)).toBeTruthy();
        // Open Glucose next.
        fireEvent.click(pillBody('Glucose'));
        reports = screen.getAllByTestId('lab-report-stub');
        expect(reports).toHaveLength(1);
        expect(reports[0].getAttribute('data-result-id')).toBe('100');
    });

    it('dismissing a pill removes it from the stack (X button on the pill)', async () => {
        await renderScreen({
            apiData: {
                labOrders: [
                    { id: 100, order_id: 100, test_name: 'Glucose', is_ready: 1, viewed_at: null },
                    { id: 200, order_id: 200, test_name: 'Sodium',  is_ready: 1, viewed_at: null },
                ],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-100')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-100'));
        fireEvent.click(screen.getByText('worklist-row-200'));
        expect(screen.getAllByText(/Glucose|Sodium/)).toHaveLength(2);
        fireEvent.click(screen.getByLabelText(/Remove Glucose from stack/));
        expect(screen.queryByText('Glucose')).toBeNull();
        expect(screen.getByText('Sodium')).toBeTruthy();
    });

    it('orders already marked viewed by the server auto-populate the pill row on first poll', async () => {
        await renderScreen({
            apiData: {
                labOrders: [
                    { id: 11, order_id: 11, test_name: 'CBC',          is_ready: 1, viewed_at: '2026-05-13T10:00:00Z' },
                    { id: 22, order_id: 22, test_name: 'Glucose',      is_ready: 1, viewed_at: '2026-05-13T10:05:00Z' },
                    { id: 33, order_id: 33, test_name: 'Awaiting Lab', is_ready: 0, viewed_at: null },
                ],
            },
        });
        // Two viewed → two pills, no pill for the not-yet-viewed order.
        await waitFor(() => {
            expect(screen.getByText('CBC')).toBeTruthy();
            expect(screen.getByText('Glucose')).toBeTruthy();
        });
        expect(screen.queryByText('Awaiting Lab')).toBeNull();
        expect(screen.queryByTestId('lab-report-stub')).toBeNull();
    });

    it('worklist receives an openOrderIds Set covering the pill stack', async () => {
        await renderScreen({
            apiData: {
                labOrders: [
                    { id: 100, order_id: 100, test_name: 'Glucose', is_ready: 1, viewed_at: null },
                    { id: 200, order_id: 200, test_name: 'Sodium',  is_ready: 1, viewed_at: null },
                ],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-100')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-100'));
        const row100 = screen.getByText('worklist-row-100');
        const row200 = screen.getByText('worklist-row-200');
        expect(row100.getAttribute('data-open')).toBe('true');
        expect(row200.getAttribute('data-open')).toBe('false');
        expect(screen.getByTestId('worklist-stub').getAttribute('data-open-count')).toBe('1');
    });
});

describe('InvestigationsScreen — notes drawer', () => {
    it('is hidden initially and opens on Notes click', async () => {
        await renderScreen({ sessionId: 'sess-99' });
        expect(screen.queryByTestId('notes-drawer')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Notes$/ }));
        const drawer = await screen.findByTestId('notes-drawer');
        expect(drawer.getAttribute('data-session-id')).toBe('sess-99');
        expect(drawer.getAttribute('data-title')).toBe('Investigations notes');
    });

    it('closes via its own onClose', async () => {
        await renderScreen();
        fireEvent.click(screen.getByRole('button', { name: /^Notes$/ }));
        fireEvent.click(screen.getByText('close-notes'));
        expect(screen.queryByTestId('notes-drawer')).toBeNull();
    });
});

describe('InvestigationsScreen — ordering', () => {
    it('submits selected lab ids with room=lab so the server can stamp learning_events', async () => {
        apiPost.mockResolvedValue({});
        await renderScreen({
            apiData: { labs: [{ id: 1, test_name: 'CBC', test_group: 'Hematology', turnaround_minutes: 15 }] },
        });
        fireEvent.click(screen.getByText('toggle-first'));
        fireEvent.click(screen.getByText('submit-stub'));
        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                expect.stringContaining('/order-labs'),
                expect.objectContaining({ lab_ids: [1], room: 'lab' }),
            );
        });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
        expect(ordered).toHaveBeenCalledWith('lab', 'CBC', expect.objectContaining({ urgency: 'routine' }));
    });

    it('submits radiology ids with room=radiology when activeKind=radiology', async () => {
        apiPost.mockResolvedValue({});
        await renderScreen({
            activeKind: 'radiology',
            apiData: { studies: [{ id: 7, name: 'CT Head', modality: 'CT', turnaround_minutes: 30 }] },
        });
        fireEvent.click(screen.getByText('toggle-first'));
        fireEvent.click(screen.getByText('submit-stub'));
        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                expect.stringContaining('/order-radiology'),
                expect.objectContaining({ radiology_ids: [7], room: 'radiology' }),
            );
        });
    });

    it('"Order instantly" on labs sends turnaround_override=0', async () => {
        apiPost.mockResolvedValue({});
        await renderScreen({
            apiData: { labs: [{ id: 1, test_name: 'CBC', test_group: 'Hematology', turnaround_minutes: 1 }] },
        });
        fireEvent.click(screen.getByText('toggle-first'));
        fireEvent.click(screen.getByText('submit-instant-stub'));
        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                expect.stringContaining('/order-labs'),
                expect.objectContaining({ lab_ids: [1], room: 'lab', turnaround_override: 0 }),
            );
        });
    });

    it('"Order instantly" on radiology sends turnaround_override=0 + instant=true', async () => {
        apiPost.mockResolvedValue({});
        await renderScreen({
            activeKind: 'radiology',
            apiData: { studies: [{ id: 7, name: 'CT Head', modality: 'CT', turnaround_minutes: 3 }] },
        });
        fireEvent.click(screen.getByText('toggle-first'));
        fireEvent.click(screen.getByText('submit-instant-stub'));
        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                expect.stringContaining('/order-radiology'),
                expect.objectContaining({
                    radiology_ids: [7],
                    room: 'radiology',
                    turnaround_override: 0,
                    instant: true,
                }),
            );
        });
    });
});
