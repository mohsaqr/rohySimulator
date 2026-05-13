// Contract for InvestigationsScreen — the full-page workspace that
// replaces the old OrdersDrawer + LabResultsModal + RadiologyResultsModal
// flow when ordering labs/radiology and viewing results.
//
// We stub the catalogue + worklist + report views so this test stays
// focused on the screen's own contract:
//   1. Topbar shows the screen title + case name + Back + Notes.
//   2. Tab strip starts on Laboratory; switching to Radiology swaps the
//      mounted viewer component.
//   3. Catalogue + Worklist mount with the right `kind` for each tab.
//   4. Selecting a ready order from the worklist renders the matching
//      report view in the right pane with the result piped through.
//   5. Notes drawer is hidden on mount, opens on Notes click, closes
//      on its onClose.
//   6. Back invokes onClose.
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
            </div>
        );
    },
}));
vi.mock('./InvestigationWorklist', () => ({
    default: function WorklistStub({ orders, selectedOrderId, onSelectOrder }) {
        return (
            <div data-testid="worklist-stub" data-orders={orders.length} data-selected={selectedOrderId ?? ''}>
                {orders.map((o) => (
                    <button key={o.id} type="button" onClick={() => onSelectOrder(o)}>
                        worklist-row-{o.id}
                    </button>
                ))}
            </div>
        );
    },
}));
vi.mock('./LabReportView', () => ({
    default: function LabReportStub({ result }) {
        return <div data-testid="lab-report-stub" data-result-id={result.order_id ?? result.id} />;
    },
}));
vi.mock('./RadiologyReportView', () => ({
    default: function RadiologyReportStub({ result }) {
        return <div data-testid="radiology-report-stub" data-result-id={result.id} />;
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
    const onClose = overrides.onClose ?? vi.fn();
    const utils = render(
        <InvestigationsScreen
            activeCase={overrides.activeCase ?? baseCase}
            sessionId={overrides.sessionId ?? 'sess-1'}
            patientInfo={overrides.patientInfo ?? basePatientInfo}
            onClose={onClose}
        />
    );
    // Let initial catalogue + orders fetches settle.
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    return { ...utils, onClose };
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
    it('renders the screen title and case name', async () => {
        await renderScreen();
        expect(screen.getByText('Investigations')).toBeTruthy();
        expect(screen.getByText(/Acute Chest Pain - STEMI/)).toBeTruthy();
    });

    it('falls back to "Patient" when both name and patient_name are missing', async () => {
        await renderScreen({ activeCase: { id: 2, config: {} } });
        // Title and case name render in sibling spans; assert the
        // fallback case label appears anywhere in the topbar.
        const topbar = screen.getByText('Investigations').closest('header');
        expect(topbar).toBeTruthy();
        expect(topbar.textContent).toMatch(/Patient/);
    });
});

describe('InvestigationsScreen — tabs', () => {
    it('starts on Laboratory; the catalogue stub is mounted with kind=lab', async () => {
        await renderScreen({ apiData: { labs: [{ id: 1, test_name: 'CBC', test_group: 'Hematology' }] } });
        await waitFor(() => {
            expect(screen.getByTestId('catalogue-stub').getAttribute('data-kind')).toBe('lab');
        });
    });

    it('switches to Radiology when the tab is clicked', async () => {
        await renderScreen({
            apiData: {
                studies: [{ id: 7, name: 'CT Head', modality: 'CT', turnaround_minutes: 30 }],
            },
        });
        fireEvent.click(screen.getByRole('button', { name: /Radiology Room/ }));
        await waitFor(() => {
            expect(screen.getByTestId('catalogue-stub').getAttribute('data-kind')).toBe('radiology');
        });
    });
});

describe('InvestigationsScreen — worklist → viewer wiring', () => {
    it('renders the department dashboard when no order is selected', async () => {
        await renderScreen();
        // The empty viewer is now a department welcome panel. Assert the
        // stable "Welcome to" label — "Laboratory Investigations" itself
        // also appears in the big department header above, so use
        // getAllByText if asserting on it.
        expect(screen.getByText(/Welcome to/)).toBeTruthy();
        expect(screen.getAllByText('Laboratory Investigations').length).toBeGreaterThan(0);
    });

    it('selecting a ready lab order renders LabReportView with that result', async () => {
        await renderScreen({
            apiData: {
                labOrders: [{ id: 100, order_id: 100, test_name: 'Glucose', is_ready: 1, viewed_at: null }],
            },
        });
        await waitFor(() => expect(screen.getByText('worklist-row-100')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-100'));
        const report = await screen.findByTestId('lab-report-stub');
        expect(report.getAttribute('data-result-id')).toBe('100');
    });

    it('selecting a ready radiology order on the Radiology tab renders RadiologyReportView', async () => {
        await renderScreen({
            apiData: {
                radOrders: [{ id: 33, test_name: 'CXR PA', modality: 'XR', is_ready: 1, viewed_at: null }],
            },
        });
        fireEvent.click(screen.getByRole('button', { name: /Radiology Room/ }));
        await waitFor(() => expect(screen.getByText('worklist-row-33')).toBeTruthy());
        fireEvent.click(screen.getByText('worklist-row-33'));
        const report = await screen.findByTestId('radiology-report-stub');
        expect(report.getAttribute('data-result-id')).toBe('33');
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

describe('InvestigationsScreen — Back + ordering', () => {
    it('invokes onClose when Back is clicked', async () => {
        const { onClose } = await renderScreen();
        fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('submits selected lab ids and reports success via toast + PatientRecord.ordered', async () => {
        apiPost.mockResolvedValue({});
        await renderScreen({
            apiData: { labs: [{ id: 1, test_name: 'CBC', test_group: 'Hematology', turnaround_minutes: 15 }] },
        });
        fireEvent.click(screen.getByText('toggle-first'));
        fireEvent.click(screen.getByText('submit-stub'));
        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                expect.stringContaining('/order-labs'),
                expect.objectContaining({ lab_ids: [1] }),
            );
        });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
        expect(ordered).toHaveBeenCalledWith('lab', 'CBC', expect.objectContaining({ urgency: 'routine' }));
    });
});
