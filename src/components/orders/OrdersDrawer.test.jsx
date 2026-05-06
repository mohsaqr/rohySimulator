// Tests for src/components/orders/OrdersDrawer.jsx — the lab + radiology +
// treatment orders drawer for the active session. Phase 4 lock-in for the
// Stage-2 idempotency work and the order-status rendering pipeline.
//
// CONTRACT (locked from src/components/orders/OrdersDrawer.jsx):
//   - On mount, the drawer fires (per session):
//       GET /api/sessions/:id/available-labs
//       GET /api/sessions/:id/available-radiology
//       GET /api/sessions/:id/orders               (re-fetched every
//                                                    labSettings.autoRefreshInterval)
//       GET /api/sessions/:id/radiology-orders     (re-fetched every 5s)
//       GET /api/sessions/:id/treatment-orders?status=ordered
//   - When labOrders.length > 0 and the drawer is collapsed, a floating
//     "Ordered Tests (N)" panel renders with READY / PENDING / VIEWED
//     sections.
//   - The five floating tab buttons (Laboratory / Radiology / Treatments /
//     Records / Memory) are visible whenever the drawer is collapsed and
//     `caseId && sessionId` are both truthy.
//   - "Order N Test(s)" button calls
//        POST /api/sessions/:id/order-labs
//        body: { lab_ids, turnaround_override }
//     and on success calls toast.success + clears selectedLabs + refetches
//     /orders.
//   - "Order N Stud(y|ies)" button calls
//        POST /api/sessions/:id/order-radiology
//        body: { radiology_ids, instant }
//   - Idempotency surface (server returns `skipped_duplicates`): the drawer
//     itself does NOT inspect or surface this field — it only checks
//     `response.ok` and announces "Ordered N test(s)". We lock the
//     network behaviour (drawer sends one POST per click; server-level
//     dedup is server-side and out of scope for this UI test).
//   - Clicking a "View" button on a ready order calls onViewResult(order)
//     (a prop callback). PUT /orders/:id/view is fired by the *result
//     modal* (see ResultsModal.jsx), NOT this drawer. We lock the
//     onViewResult call here.
//   - if !caseId or !sessionId, the drawer renders nothing (returns null).
//
// SPEC DIVERGENCE (documented for future work, NOT testable today):
//   - Bulk-delete confirmation flow: the drawer source has no bulk-delete
//     UI as of this writing — selectedLabs is populated by checkboxes and
//     submitted via "Order", not deleted. There is no "Delete N selected"
//     button to click. We do NOT invent the missing UI. A guard test
//     below pins the *current* surface (no delete buttons present).
//   - PUT /orders/:id/view is fired by ResultsModal, not OrdersDrawer.
//     The onViewResult callback locked here is the drawer's contribution.
//
// Provider stack: renderWithProviders mounts AuthProvider + ToastProvider
// + VoiceProvider + NotificationProvider. PatientRecordProvider is opt-in
// — we don't mount it (the drawer's `usePatientRecord()` returns the
// no-op fallback when the provider is absent).

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import OrdersDrawer from './OrdersDrawer.jsx';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';

// --- Mock heavy children + side-effect singletons --------------------------
// The drawer pulls in PatientRecordViewer, ClinicalRecordsPanel, TreatmentPanel,
// and EventLogger. None of those are under test here; stub them out so this
// file stays focused on the drawer's own surface.
vi.mock('../PatientRecordViewer', () => ({
    default: () => <div data-testid="patient-record-viewer-stub" />,
}));
vi.mock('../investigations/ClinicalRecordsPanel', () => ({
    default: () => <div data-testid="clinical-records-panel-stub" />,
}));
vi.mock('../treatments', () => ({
    TreatmentPanel: () => <div data-testid="treatment-panel-stub" />,
}));
vi.mock('../../services/eventLogger', () => ({
    default: {
        drawerOpened: vi.fn(),
        drawerClosed: vi.fn(),
        tabSwitched: vi.fn(),
        labOrdered: vi.fn(),
        labSearched: vi.fn(),
        labFiltered: vi.fn(),
        settingChanged: vi.fn(),
    },
    COMPONENTS: { ORDERS_DRAWER: 'OrdersDrawer' },
}));
vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => 'tok-test',
        verifyToken: vi.fn(async () => null),
    },
}));

// --- msw server -------------------------------------------------------------
// Track POSTs so tests can assert idempotency / call counts.
const calls = {
    orderLabs: [],
    orderRadiology: [],
};

const seededLabs = [
    { id: 'lab-cbc-wbc', test_name: 'WBC', test_group: 'CBC', turnaround_minutes: 30 },
    { id: 'lab-bmp-na', test_name: 'Sodium', test_group: 'BMP', turnaround_minutes: 20 },
];
const seededRadiology = [
    { id: 'rad-cxr', name: 'Chest X-Ray', modality: 'X-Ray', turnaround_minutes: 15, body_region: 'chest' },
];
let labOrdersFixture = [];
let radiologyOrdersFixture = [];

function defaultHandlers() {
    return [
        http.get('*/api/sessions/:id/available-labs', () =>
            HttpResponse.json({ labs: seededLabs })
        ),
        http.get('*/api/sessions/:id/available-radiology', () =>
            HttpResponse.json({ studies: seededRadiology, groups: ['X-Ray'] })
        ),
        http.get('*/api/sessions/:id/orders', () =>
            HttpResponse.json({ orders: labOrdersFixture })
        ),
        http.get('*/api/sessions/:id/radiology-orders', () =>
            HttpResponse.json({ orders: radiologyOrdersFixture })
        ),
        http.get('*/api/sessions/:id/treatment-orders', () =>
            HttpResponse.json({ orders: [] })
        ),
        http.post('*/api/sessions/:id/order-labs', async ({ request }) => {
            const body = await request.json();
            calls.orderLabs.push(body);
            // Server-side idempotency: count repeats of any lab_id we've already
            // seen across previous calls in this test run.
            const seen = new Set(
                calls.orderLabs.slice(0, -1).flatMap(c => c.lab_ids || [])
            );
            const skipped = (body.lab_ids || []).filter(id => seen.has(id)).length;
            const inserted = (body.lab_ids || []).length - skipped;
            return HttpResponse.json({
                success: true,
                ordered: inserted,
                skipped_duplicates: skipped,
            });
        }),
        http.post('*/api/sessions/:id/order-radiology', async ({ request }) => {
            const body = await request.json();
            calls.orderRadiology.push(body);
            const seen = new Set(
                calls.orderRadiology.slice(0, -1).flatMap(c => c.radiology_ids || [])
            );
            const skipped = (body.radiology_ids || []).filter(id => seen.has(id)).length;
            const inserted = (body.radiology_ids || []).length - skipped;
            return HttpResponse.json({
                success: true,
                ordered: inserted,
                skipped_duplicates: skipped,
            });
        }),
        http.put('*/api/orders/:id/view', () =>
            HttpResponse.json({ success: true })
        ),
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: null }, { status: 401 })
        ),
        http.get('*/api/*', () => HttpResponse.json({})),
    ];
}

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
    server.resetHandlers(...defaultHandlers());
    calls.orderLabs = [];
    calls.orderRadiology = [];
    labOrdersFixture = [];
    radiologyOrdersFixture = [];
});
afterAll(() => server.close());

// Common props the drawer needs.
function baseProps(overrides = {}) {
    return {
        caseId: 'case-1',
        sessionId: 'session-42',
        onViewResult: vi.fn(),
        caseData: { config: {} },
        onOpenExamination: undefined,
        ...overrides,
    };
}

// Helper: open the drawer to a given tab. The drawer starts collapsed and
// the *floating* tab buttons (rendered only when !isOpen) are how a real
// user opens it. Both the floating buttons and the drawer-internal tab
// buttons share label text, so we find the floating button by its parent
// (`.fixed.bottom-4.right-4` container).
async function openDrawer(tab = 'labs') {
    const labelMap = { labs: 'Laboratory', radiology: 'Radiology', records: 'Records', memory: 'Memory', treatments: 'Treatments' };
    const label = labelMap[tab];
    const matches = screen.getAllByText(label);
    // Floating-button container has class "fixed bottom-4 right-4" (only
    // present while drawer is collapsed). Pick the match that lives inside it.
    const floating = matches.find(el => el.closest('.fixed.bottom-4.right-4')) || matches[0];
    const btn = floating.closest('button');
    expect(btn).toBeTruthy();
    await act(async () => { fireEvent.click(btn); });
}

describe('OrdersDrawer — guard render', () => {
    it('renders nothing when caseId is missing', () => {
        const { container } = renderWithProviders(
            <OrdersDrawer {...baseProps({ caseId: null })} />
        );
        expect(container.querySelector('button')).toBeNull();
    });

    it('renders nothing when sessionId is missing', () => {
        const { container } = renderWithProviders(
            <OrdersDrawer {...baseProps({ sessionId: null })} />
        );
        expect(container.querySelector('button')).toBeNull();
    });

    it('renders the five floating tab buttons when caseId+sessionId are set', async () => {
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        // Both floating + drawer-internal buttons render the same labels (the
        // drawer is hidden via translate-y but still in the DOM). Use
        // getAllByText so we don't fail on the duplicates.
        await waitFor(() => {
            expect(screen.getAllByText('Laboratory').length).toBeGreaterThan(0);
        });
        expect(screen.getAllByText('Radiology').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Treatments').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Records').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Memory').length).toBeGreaterThan(0);
    });
});

describe('OrdersDrawer — orders list rendering', () => {
    it('renders the floating "Ordered Tests" panel with seeded orders', async () => {
        labOrdersFixture = [
            {
                id: 'o1',
                investigation_id: 'lab-cbc-wbc',
                test_name: 'WBC',
                is_ready: true,
                viewed_at: null,
                minutes_remaining: 0,
                available_at: new Date(Date.now() - 60000).toISOString(),
            },
            {
                id: 'o2',
                investigation_id: 'lab-bmp-na',
                test_name: 'Sodium',
                is_ready: false,
                viewed_at: null,
                minutes_remaining: 5,
                available_at: new Date(Date.now() + 5 * 60000).toISOString(),
            },
        ];
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        // The panel header reads "Ordered Tests (2)".
        await waitFor(() => {
            expect(screen.getByText(/Ordered Tests \(2\)/)).toBeInTheDocument();
        });
        // Both order names appear.
        expect(screen.getAllByText('WBC').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Sodium').length).toBeGreaterThan(0);
    });
});

describe('OrdersDrawer — POST /order-labs', () => {
    it('clicking "Order N Tests" sends POST with lab_ids in the body', async () => {
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        await waitFor(() => {
            expect(screen.getAllByText('Laboratory').length).toBeGreaterThan(0);
        });
        await openDrawer('labs');

        // Pick the first available lab via its checkbox.
        const wbcCheckbox = await waitFor(() => {
            const labels = screen.getAllByText('WBC');
            const label = labels.find(el => el.closest('label'));
            return label.closest('label').querySelector('input[type="checkbox"]');
        });
        await act(async () => { fireEvent.click(wbcCheckbox); });

        // The order button text reads "Order 1 Test".
        const orderBtn = await waitFor(() => screen.getByText(/Order 1 Test/i));
        await act(async () => { fireEvent.click(orderBtn); });

        await waitFor(() => {
            expect(calls.orderLabs.length).toBeGreaterThanOrEqual(1);
        });
        const body = calls.orderLabs[0];
        expect(body.lab_ids).toEqual(['lab-cbc-wbc']);
        // turnaround_override is null (default mode, not instant, no global).
        expect(body.turnaround_override).toBeNull();
    });

    it('idempotency: a second submission of the same lab_id reaches the server (drawer does not pre-empt)', async () => {
        // The drawer disables checkboxes for already-ordered tests, so we
        // simulate the "double-click race" by manually firing two POSTs back
        // to back via the drawer's normal flow: the second goes through after
        // labOrders re-syncs (we leave labOrdersFixture empty so the drawer
        // never sees the first order land on the server's read side).
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        await waitFor(() => expect(screen.getAllByText('Laboratory').length).toBeGreaterThan(0));
        await openDrawer('labs');

        const wbcCheckbox = await waitFor(() => {
            const labels = screen.getAllByText('WBC');
            return labels.find(el => el.closest('label')).closest('label').querySelector('input[type="checkbox"]');
        });
        await act(async () => { fireEvent.click(wbcCheckbox); });
        const orderBtn = await waitFor(() => screen.getByText(/Order 1 Test/i));
        await act(async () => { fireEvent.click(orderBtn); });
        await waitFor(() => expect(calls.orderLabs.length).toBe(1));

        // Submit again — re-select and click.
        const wbcCheckbox2 = await waitFor(() => {
            const labels = screen.getAllByText('WBC');
            return labels.find(el => el.closest('label')).closest('label').querySelector('input[type="checkbox"]');
        });
        await act(async () => { fireEvent.click(wbcCheckbox2); });
        const orderBtn2 = await waitFor(() => screen.getByText(/Order 1 Test/i));
        await act(async () => { fireEvent.click(orderBtn2); });

        await waitFor(() => expect(calls.orderLabs.length).toBe(2));
        // Both POSTs hit the server — the second is the duplicate. Server
        // returned skipped_duplicates:1 for it, but the drawer surfaces only
        // toast.success("Ordered N test(s)") regardless. The contract here
        // is "drawer does not pre-empt the second POST" — locked.
        expect(calls.orderLabs[0].lab_ids).toEqual(['lab-cbc-wbc']);
        expect(calls.orderLabs[1].lab_ids).toEqual(['lab-cbc-wbc']);
    });
});

describe('OrdersDrawer — POST /order-radiology', () => {
    it('clicking "Order N Studies" sends POST with radiology_ids in the body', async () => {
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        await waitFor(() => expect(screen.getAllByText('Radiology').length).toBeGreaterThan(0));
        await openDrawer('radiology');

        // Find the chest x-ray checkbox.
        const cxrCheckbox = await waitFor(() => {
            const labels = screen.getAllByText('Chest X-Ray');
            return labels.find(el => el.closest('label')).closest('label').querySelector('input[type="checkbox"]');
        });
        await act(async () => { fireEvent.click(cxrCheckbox); });

        const orderBtn = await waitFor(() => screen.getByText(/Order 1 Study/i));
        await act(async () => { fireEvent.click(orderBtn); });

        await waitFor(() => expect(calls.orderRadiology.length).toBeGreaterThanOrEqual(1));
        const body = calls.orderRadiology[0];
        expect(body.radiology_ids).toEqual(['rad-cxr']);
        expect(body).toHaveProperty('instant');
    });

    it('idempotency: re-submitting the same radiology_id results in two POSTs (drawer does not pre-empt)', async () => {
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        await waitFor(() => expect(screen.getAllByText('Radiology').length).toBeGreaterThan(0));
        await openDrawer('radiology');

        const click = async () => {
            const cb = await waitFor(() => {
                const labels = screen.getAllByText('Chest X-Ray');
                return labels.find(el => el.closest('label')).closest('label').querySelector('input[type="checkbox"]');
            });
            await act(async () => { fireEvent.click(cb); });
            const btn = await waitFor(() => screen.getByText(/Order 1 Study/i));
            await act(async () => { fireEvent.click(btn); });
        };

        await click();
        await waitFor(() => expect(calls.orderRadiology.length).toBe(1));
        await click();
        await waitFor(() => expect(calls.orderRadiology.length).toBe(2));
        expect(calls.orderRadiology[0].radiology_ids).toEqual(['rad-cxr']);
        expect(calls.orderRadiology[1].radiology_ids).toEqual(['rad-cxr']);
    });
});

describe('OrdersDrawer — view action', () => {
    it('clicking "View" on a ready order calls onViewResult(order) once', async () => {
        const order = {
            id: 'o-ready',
            investigation_id: 'lab-cbc-wbc',
            test_name: 'WBC',
            is_ready: true,
            viewed_at: null,
            minutes_remaining: 0,
            available_at: new Date(Date.now() - 60000).toISOString(),
        };
        labOrdersFixture = [order];
        const onViewResult = vi.fn();
        renderWithProviders(<OrdersDrawer {...baseProps({ onViewResult })} />);

        // Wait for the floating "Ordered Tests" panel to render.
        const viewBtn = await waitFor(() => {
            const matches = screen.getAllByText(/^View$/);
            return matches[0];
        });
        await act(async () => { fireEvent.click(viewBtn); });

        expect(onViewResult).toHaveBeenCalledTimes(1);
        const passed = onViewResult.mock.calls[0][0];
        expect(passed.id).toBe('o-ready');
        expect(passed.test_name).toBe('WBC');
        // The PUT /orders/:id/view is fired by the *result modal* (see
        // ResultsModal.jsx), not the drawer. The drawer's contribution is
        // the onViewResult callback — locked above.
    });

    it('clicking "View" twice on the same order calls onViewResult twice (drawer surface, no internal dedup)', async () => {
        labOrdersFixture = [{
            id: 'o-ready-2',
            investigation_id: 'lab-bmp-na',
            test_name: 'Sodium',
            is_ready: true,
            viewed_at: null,
            minutes_remaining: 0,
            available_at: new Date(Date.now() - 60000).toISOString(),
        }];
        const onViewResult = vi.fn();
        renderWithProviders(<OrdersDrawer {...baseProps({ onViewResult })} />);

        const firstClick = await waitFor(() => screen.getAllByText(/^View$/)[0]);
        await act(async () => { fireEvent.click(firstClick); });
        const secondClick = screen.getAllByText(/^View$/)[0];
        await act(async () => { fireEvent.click(secondClick); });

        expect(onViewResult).toHaveBeenCalledTimes(2);
        // The dedup contract for /orders/:id/view lives in ResultsModal +
        // server route, not here. Drawer fires the callback once per click
        // — locked.
    });
});

describe('OrdersDrawer — bulk-delete confirmation (spec divergence)', () => {
    it('drawer source has no bulk-delete UI (current contract)', async () => {
        // CONTRACT divergence note: The Phase-4 spec describes a Stage-2
        // bulk-delete-with-confirmation flow. The drawer source has no
        // selection-aware delete button as of this writing — the only
        // batched action is "Order N Test(s)". This test pins the absence
        // so a future addition forces an explicit update of this file.
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        await waitFor(() => expect(screen.getAllByText('Laboratory').length).toBeGreaterThan(0));
        // No "Delete N selected", "Bulk delete", or "Confirm delete" button.
        expect(screen.queryByText(/Delete \d+ selected/i)).toBeNull();
        expect(screen.queryByText(/Bulk delete/i)).toBeNull();
        expect(screen.queryByText(/Confirm delete/i)).toBeNull();
    });
});
