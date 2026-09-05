// OrdersDrawer — regression locks from the UI test review 2.9.108.
//
// Kept separate from OrdersDrawer.test.jsx (which owns the Memory-gate and
// guard-render contract) because these three findings share one theme: the
// drawer was doing work for a surface nobody could reach.
//
//   #9  Every lab order was logged twice. The server writes one
//       ORDERED_LAB learning_events row per test on POST /order-labs
//       (server/routes/orders-routes.js, `finalizeOrders`), and the
//       drawer's own submit handler ALSO called EventLogger.labOrdered()
//       for each test — the same verb, from the browser. TNA resource
//       counts and Engagement reports read those rows, so both doubled.
//       The server is authoritative; the client copy is gone. The handler
//       also console.log'd every lab id it submitted.
//
//   #20 ~596 lines of labs/radiology JSX that `activeTab` could never
//       select (the tab strip offers only treatments/records/memory), plus
//       two 5-second polling loops feeding them — 12 requests per 30 s per
//       learner for data that could not render. Lab and radiology ordering
//       live in InvestigationsScreen.
//
//   #21 The Treatments badge counted only status='ordered', so it read 0
//       while an infusion was running, and the "refresh now" callback was
//       `setTreatmentOrdersCount(c => c)` — a functional identity update
//       React bails out of.

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import eventLogger from '../../services/eventLogger';
import OrdersDrawer from './OrdersDrawer.jsx';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';

vi.mock('../PatientRecordViewer', () => ({
    default: () => <div data-testid="patient-record-viewer-stub" />,
}));
vi.mock('../investigations/ClinicalRecordsPanel', () => ({
    default: () => <div data-testid="clinical-records-panel-stub" />,
}));

// TreatmentPanel is stubbed with a button that fires onEffectsUpdate, which
// is how the real panel signals "I just administered/discontinued something,
// refresh the badge".
vi.mock('../treatments', () => ({
    TreatmentPanel: ({ onEffectsUpdate }) => (
        <button data-testid="fire-effects-update" onClick={() => onEffectsUpdate?.()}>
            fire
        </button>
    ),
}));

// vi.mock is hoisted, so the spy bag must be created inside the factory
// and read back through the mocked module afterwards.
vi.mock('../../services/eventLogger', async (importOriginal) => ({ ...(await importOriginal()),
    default: {
        drawerOpened: vi.fn(),
        drawerClosed: vi.fn(),
        tabSwitched: vi.fn(),
        labOrdered: vi.fn(),
        radiologyOrdered: vi.fn(),
        labSearched: vi.fn(),
        labFiltered: vi.fn(),
        settingChanged: vi.fn(),
        componentOpened: vi.fn(),
        componentClosed: vi.fn(),
        panelOpened: vi.fn(),
        panelClosed: vi.fn(),
        getStatus: vi.fn(() => ({ room: 'chat' })),
    },
    COMPONENTS: { ORDERS_DRAWER: 'OrdersDrawer' },
}));
vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => 'tok-test',
        verifyToken: vi.fn(async () => null),
    },
}));

// Every /api path the drawer could conceivably touch is recorded so the
// dead-poll lock can assert on the whole request log.
const requested = [];
let treatmentOrders = [];

function defaultHandlers() {
    return [
        http.get('*/api/sessions/:id/treatment-orders', ({ request }) => {
            requested.push(new URL(request.url).pathname + new URL(request.url).search);
            return HttpResponse.json({ orders: treatmentOrders });
        }),
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: null }, { status: 401 })
        ),
        http.get('*/api/*', ({ request }) => {
            requested.push(new URL(request.url).pathname);
            return HttpResponse.json({});
        }),
        http.post('*/api/*', ({ request }) => {
            requested.push('POST ' + new URL(request.url).pathname);
            return HttpResponse.json({});
        }),
    ];
}

const server = setupServer(...defaultHandlers());
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
    server.resetHandlers(...defaultHandlers());
    requested.length = 0;
    treatmentOrders = [];
    Object.values(eventLogger).forEach(fn => fn.mockClear?.());
});
afterAll(() => server.close());

function baseProps(overrides = {}) {
    return {
        caseId: 'case-1',
        sessionId: 'session-42',
        onViewResult: vi.fn(),
        caseData: { config: {} },
        ...overrides,
    };
}

// Read the component source for the contract assertions below. A deleted
// code path is best pinned at the source, because there is by definition no
// UI left to drive.
async function drawerSource() {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return fs.readFileSync(path.resolve(__dirname, 'OrdersDrawer.jsx'), 'utf8');
}

describe('OrdersDrawer — #9 the server owns lab-order logging', () => {
    // Regression lock: the drawer must never emit a client-side ORDERED_LAB
    // row. Against the un-fixed component `handleOrderLabs` called
    // EventLogger.labOrdered() once per selected test, doubling every lab
    // order in learning_events on top of the server's own per-test rows.
    it('contains no EventLogger.labOrdered call', async () => {
        const src = await drawerSource();
        expect(src).not.toContain('labOrdered');
        expect(src).not.toContain('EventLogger.labSearched');
        expect(src).not.toContain('EventLogger.labFiltered');
    });

    // Regression lock: :259 console.log'd the session id and every lab id
    // on each submission. Nothing in src/ may console.log — logging goes
    // through EventLogger / the notification center.
    it('contains no console.log', async () => {
        expect(await drawerSource()).not.toContain('console.log');
    });

    // Behavioural companion: mounting and driving every reachable surface
    // must produce zero lab/radiology order events from the client.
    it('never fires a client order event while the drawer is driven', async () => {
        renderWithProviders(<OrdersDrawer {...baseProps({ isAdmin: true })} />);
        await waitFor(() => expect(screen.getAllByText('Treatments').length).toBeGreaterThan(0));

        for (const label of ['Treatments', 'Records', 'Memory']) {
            const pill = screen.getAllByText(label)[0].closest('button');
            // eslint-disable-next-line no-await-in-loop
            await act(async () => { fireEvent.click(pill); });
        }

        expect(eventLogger.labOrdered).not.toHaveBeenCalled();
        expect(eventLogger.radiologyOrdered).not.toHaveBeenCalled();
    });
});

describe('OrdersDrawer — #20 the dead labs/radiology surface is gone', () => {
    // Regression lock: the drawer polled /orders every
    // labSettings.autoRefreshInterval (5 s) and /radiology-orders every 5 s,
    // and fetched /available-labs + /available-radiology on mount — all to
    // feed JSX that `activeTab` could never select. The only endpoint it
    // may touch now is the treatment-order count behind its own badge.
    it('requests nothing but its own treatment-order count', async () => {
        renderWithProviders(<OrdersDrawer {...baseProps()} />);
        await waitFor(() => expect(requested.length).toBeGreaterThan(0));
        // Give any surviving mount-time fetch a chance to land.
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        const apiCalls = requested.filter(p => p.includes('/api/sessions/'));
        expect(apiCalls.length).toBeGreaterThan(0);
        apiCalls.forEach(path => {
            expect(path).toContain('/treatment-orders');
        });
        expect(requested.some(p => p.includes('available-labs'))).toBe(false);
        expect(requested.some(p => p.includes('available-radiology'))).toBe(false);
        expect(requested.some(p => p.endsWith('/orders'))).toBe(false);
        expect(requested.some(p => p.includes('radiology-orders'))).toBe(false);
    });

    // Regression lock: no unreachable branch may come back. `activeTab` is
    // set only from the `tabs` array, which offers treatments/records/memory.
    it('carries no activeTab branch for labs or radiology', async () => {
        const src = await drawerSource();
        expect(src).not.toContain("activeTab === 'labs'");
        expect(src).not.toContain("activeTab === 'radiology'");
        // …and the initial tab is one the strip can actually select.
        expect(src).toContain("useState('treatments')");
    });
});

describe('OrdersDrawer — #21 treatments badge', () => {
    // Regression lock: an administered continuous treatment sits at
    // 'in_progress'. Against the un-fixed component the badge asked the
    // server for `?status=ordered` only, so this session reads 0 while two
    // treatments are live on the patient.
    it('counts ordered AND in_progress treatments', async () => {
        treatmentOrders = [
            { id: 1, status: 'ordered' },
            { id: 2, status: 'in_progress' },
            { id: 3, status: 'administered' },
            { id: 4, status: 'discontinued' },
        ];
        renderWithProviders(<OrdersDrawer {...baseProps()} />);

        await waitFor(() => {
            const badge = screen.getAllByText('2');
            expect(badge.length).toBeGreaterThan(0);
        });
        // Neither the completed dose nor the stopped infusion is "active".
        expect(screen.queryByText('4')).toBeNull();
    });

    // Regression lock: onEffectsUpdate was `setTreatmentOrdersCount(c => c)`
    // — React bails out of a functional update that returns the same value,
    // so administering a treatment refreshed nothing and the badge stayed
    // stale until the next 10 s poll. It must refetch.
    it('refetches the count when the treatment panel reports a change', async () => {
        treatmentOrders = [{ id: 1, status: 'ordered' }];
        renderWithProviders(<OrdersDrawer {...baseProps()} />);

        await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));

        // Open the Treatments tab so the stubbed panel is mounted.
        const pill = screen.getAllByText('Treatments')[0].closest('button');
        await act(async () => { fireEvent.click(pill); });

        // A treatment is administered on the server; the panel calls back.
        treatmentOrders = [
            { id: 1, status: 'in_progress' },
            { id: 2, status: 'ordered' },
            { id: 3, status: 'ordered' },
        ];
        const fire = await screen.findByTestId('fire-effects-update');
        await act(async () => { fireEvent.click(fire); });

        await waitFor(() => expect(screen.getAllByText('3').length).toBeGreaterThan(0));
    });
});
