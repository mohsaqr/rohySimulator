import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import CaseTreatmentConfig from './CaseTreatmentConfig.jsx';

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

const effect = {
    id: 7,
    treatment_type: 'medication',
    treatment_name: 'Aspirin',
    route: 'PO',
    description: 'Antiplatelet',
    hr_effect: 0,
    bp_sys_effect: 0,
    spo2_effect: 0,
    onset_minutes: 5,
};

let fetchSpy;

function treatmentCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
        typeof url === 'string' && (
            url.endsWith('/api/treatment-effects') ||
            url.endsWith('/api/cases/case-1/treatments')
        )
    );
}

beforeEach(() => {
    localStorage.setItem('token', 'educator-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/treatment-effects')) {
            return Promise.resolve(jsonResponse({ effects: [effect] }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('CaseTreatmentConfig apiFetch migration', () => {
    it('loads treatment effects with bearer auth and the correct path', async () => {
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText('Aspirin')).toBeInTheDocument();

        const [url, init] = treatmentCalls()[0];
        expect(url).toBe('/api/treatment-effects');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer educator-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('PUTs the configured treatments JSON body when saved', async () => {
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        fireEvent.click(await screen.findByText('Aspirin'));
        fireEvent.click(screen.getByRole('button', { name: /expected/i }));
        fireEvent.click(screen.getByRole('button', { name: /save treatment config/i }));

        await waitFor(() => {
            expect(treatmentCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });

        const [url, init] = treatmentCalls().find(([, callInit]) => callInit?.method === 'PUT');
        expect(url).toBe('/api/cases/case-1/treatments');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer educator-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toEqual({
            treatments: [{
                treatment_type: 'medication',
                treatment_name: 'Aspirin',
                is_available: true,
                is_expected: true,
                is_contraindicated: false,
                points_if_ordered: 0,
                feedback_if_ordered: null,
                feedback_if_missed: null,
            }],
        });
    });

    it('surfaces an API error toast when saving is forbidden', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.endsWith('/api/treatment-effects')) {
                return Promise.resolve(jsonResponse({ effects: [effect] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/cases/case-1/treatments') && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /save treatment config/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('forbidden'));
    });
});

// Regression lock: Hide was not mutually exclusive with Expected/Contraindicated (bug report 2.9.15 #8)
//
// The three toggles used to write their booleans independently: Hide only
// flipped is_available, so {is_available: false, is_expected: true} was a
// reachable — and savable — combination. The status is now mutually
// exclusive (expected | contraindicated | hidden | neutral): every handler
// writes all three flags.
describe('CaseTreatmentConfig mutual exclusion (bug report 2.9.15 #8)', () => {
    async function expandAspirin() {
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );
        fireEvent.click(await screen.findByText('Aspirin'));
    }

    async function savedTreatment() {
        fireEvent.click(screen.getByRole('button', { name: /save treatment config/i }));
        await waitFor(() => {
            expect(treatmentCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });
        const [, init] = treatmentCalls().find(([, callInit]) => callInit?.method === 'PUT');
        return JSON.parse(init.body).treatments[0];
    }

    it('selecting Hide clears Expected', async () => {
        await expandAspirin();

        fireEvent.click(screen.getByRole('button', { name: 'Expected' }));
        fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

        expect(await savedTreatment()).toMatchObject({
            treatment_name: 'Aspirin',
            is_available: false,
            is_expected: false,
            is_contraindicated: false,
        });
    });

    it('selecting Contraindicated after Hide restores availability', async () => {
        await expandAspirin();

        fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
        fireEvent.click(screen.getByRole('button', { name: 'Contraindicated' }));

        expect(await savedTreatment()).toMatchObject({
            treatment_name: 'Aspirin',
            is_available: true,
            is_expected: false,
            is_contraindicated: true,
        });
    });

    it('Expected and Contraindicated clear each other', async () => {
        await expandAspirin();

        fireEvent.click(screen.getByRole('button', { name: 'Expected' }));
        fireEvent.click(screen.getByRole('button', { name: 'Contraindicated' }));

        expect(await savedTreatment()).toMatchObject({
            treatment_name: 'Aspirin',
            is_available: true,
            is_expected: false,
            is_contraindicated: true,
        });
    });
});

// Regression lock: the editor's Save (or any parent re-render) wiped unsaved treatment marks, and only the step's own button ever persisted them (QA 2026-10-04, PRV-26)
describe('CaseTreatmentConfig inside the case editor', () => {
    // Mirrors ConfigPanel: it owns the case draft, passes
    // `config?.treatments || []` (a new array every render) and re-renders for
    // reasons of its own — an auto-save, a step change.
    function EditorHarness({ onDraft }) {
        const [draft, setDraft] = React.useState({ config: {} });
        const [, setTick] = React.useState(0);
        React.useEffect(() => { onDraft(draft); }, [draft, onDraft]);
        return (
            <>
                <button type="button" onClick={() => setTick(n => n + 1)}>parent re-render</button>
                <CaseTreatmentConfig
                    caseId="case-1"
                    caseTreatments={draft.config?.treatments || []}
                    onUpdate={(treatments) => setDraft(prev => ({ ...prev, config: { ...prev.config, treatments } }))}
                />
            </>
        );
    }

    it('pushes a mark into the case draft at once and keeps it across a parent re-render', async () => {
        let latest = null;
        renderWithProviders(<EditorHarness onDraft={(d) => { latest = d; }} />,
            { withAuth: false, withNotifications: false, withToast: false });
        fireEvent.click(await screen.findByText('Aspirin'));
        fireEvent.click(screen.getByRole('button', { name: 'Contraindicated' }));

        await waitFor(() => expect(latest?.config?.treatments?.[0]).toMatchObject({
            treatment_name: 'Aspirin', is_contraindicated: true,
        }));

        fireEvent.click(screen.getByRole('button', { name: 'parent re-render' }));
        await waitFor(() => expect(latest?.config?.treatments?.[0]?.is_contraindicated).toBe(true));
        // The mark is still shown, not reset to an empty list.
        expect(screen.getByRole('button', { name: 'Contraindicated' })).toBeInTheDocument();
    });
});

describe('CaseTreatmentConfig loads the saved rubric from case_treatments', () => {
    // Regression lock: the editor read the rubric from cases.config.treatments — which students received with the case. It now lives in case_treatments only and the editor loads it from GET /cases/:id/treatments (Phase 0 security fix, 2026-10-04)
    const saved = [{
        treatment_type: 'medication', treatment_name: 'Aspirin', medication_id: null,
        is_available: true, is_expected: true, is_contraindicated: false,
        points_if_ordered: 10, feedback_if_ordered: 'Good.', feedback_if_missed: 'Give aspirin.', custom_effect_override: null,
    }];
    const withRubric = (url) => {
        if (typeof url === 'string' && url.endsWith('/api/treatment-effects')) return Promise.resolve(jsonResponse({ effects: [effect] }));
        if (typeof url === 'string' && url.endsWith('/api/cases/case-1/treatments')) return Promise.resolve(jsonResponse({ treatments: saved }));
        return Promise.resolve(jsonResponse({}));
    };

    it('loads it into the editor and the case draft when the draft holds none', async () => {
        fetchSpy.mockImplementation(withRubric);
        const onUpdate = vi.fn();
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} onUpdate={onUpdate} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );
        await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(saved));
    });

    it('never replaces a working copy the educator already has', async () => {
        fetchSpy.mockImplementation(withRubric);
        const onUpdate = vi.fn();
        const draft = [{ ...saved[0], points_if_ordered: 99 }];
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={draft} onUpdate={onUpdate} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );
        expect((await screen.findAllByText('Aspirin')).length).toBeGreaterThan(0);
        expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/api/cases/case-1/treatments'))).toBe(false);
        expect(onUpdate).not.toHaveBeenCalled();
    });
});

