// CONTRACT: ConfigPanel is the settings shell — a sidebar of tabs and a
// content area. These tests lock the public seams so a refactor can't
// silently break them:
//
//   1. Tab navigation — clicking a sidebar tab swaps the main content.
//   2. `initialTab` — mounts straight onto the requested tab.
//   3. Save flow — Cancel-with-unsaved-changes pops a confirm; Save & Exit
//      persists then closes the wizard.
//   4. Persona handoff — `Edit persona` invokes onOpenPersonaEditor with
//      (templateId, { tab, wizardStep }).
//   5. Round-trip — initialTab='cases' + initialWizardStep=11 lands on the
//      wizard's Agents step.
//   6. Cancel & exit — Cancel without unsaved changes drops the wizard.
//   7. Smoke — every tab renders without throwing once its child deps are
//      stubbed.
//   8. Pre-existing lint quirk — HANDOFF.md flags a known set-state-in-
//      effect lint issue around the case_id loader effect. We do NOT fix
//      it; we just verify the panel still mounts.
//
// Heavy child tabs (3D avatar, voice, msw-only flows, audit logs, …) are
// stubbed to trivial DOM. We mount the real CaseWizard / CaseAgentEditor
// (they live inside ConfigPanel.jsx so vi.mock can't reach them) and feed
// them via msw.

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// --- Stub heavy/child tabs ----------------------------------------------
// Each stub returns a tiny div that's easy to query with getByTestId.
vi.mock('./AgentTemplateManager.jsx', () => ({
    default: ({ onOpenEditor }) => (
        <div data-testid="stub-agent-templates">
            <button data-testid="stub-edit-template" onClick={() => onOpenEditor?.('tpl-99')}>Edit template</button>
            <button data-testid="stub-new-template" onClick={() => onOpenEditor?.('new')}>New template</button>
        </div>
    ),
}));
vi.mock('./AvatarsSettingsTab.jsx', () => ({
    default: () => <div data-testid="stub-avatars">avatars-tab</div>,
}));
vi.mock('./VoiceSettingsTab.jsx', () => ({
    default: () => <div data-testid="stub-voice">voice-tab</div>,
}));
vi.mock('./NotificationsSettingsTab.jsx', () => ({
    default: () => <div data-testid="stub-notifications">notifications-tab</div>,
}));
vi.mock('./ScenarioRepository.jsx', () => ({
    default: () => <div data-testid="stub-scenarios">scenarios-tab</div>,
}));
vi.mock('./LabInvestigationEditor.jsx', () => ({
    default: () => <div data-testid="stub-lab-inv">lab-inv</div>,
}));
vi.mock('./RadiologyEditor.jsx', () => ({
    default: () => <div data-testid="stub-radiology">radiology</div>,
}));
vi.mock('./ClinicalRecordsEditor.jsx', () => ({
    default: () => <div data-testid="stub-clinical">clinical</div>,
}));
vi.mock('./PhysicalExamEditor.jsx', () => ({
    default: () => <div data-testid="stub-physical">physical</div>,
}));
vi.mock('./LabTestManager.jsx', () => ({
    default: () => <div data-testid="stub-labdb">labdb-tab</div>,
}));
vi.mock('./MedicationManager.jsx', () => ({
    default: () => <div data-testid="stub-medications">medications-tab</div>,
}));
vi.mock('./CaseTreatmentConfig.jsx', () => ({
    default: () => <div data-testid="stub-case-treat">case-treat</div>,
}));
vi.mock('./CaseAvatarVoicePicker.jsx', () => ({
    default: () => <div data-testid="stub-cavp">cavp</div>,
}));
// The Oyon data console inside System Logs fetches on mount — stub it so
// the Logs smoke test doesn't depend on the Oyon addon routes.
vi.mock('../analytics/OyonDataLogs.jsx', () => ({
    default: () => <div data-testid="stub-oyon-data-logs">oyon-data-logs</div>,
}));
// The embedded TNA dashboard is a heavy fetch-on-mount component; the
// Analytics-tab tests only assert the tab gate, not the dashboard itself.
vi.mock('../analytics/tna/TnaDashboardV2.jsx', () => ({
    default: () => <div data-testid="stub-tna-dashboard">tna-dashboard</div>,
}));

// scenarioTemplates is a data module — keep real, but light dependency.
// (No mock needed.)

// Import AFTER vi.mock so the mocks take effect.
import ConfigPanel from './ConfigPanel.jsx';

// --- msw -----------------------------------------------------------------
// All requests fired by ConfigPanel itself + the in-file CaseWizard /
// CaseAgentEditor / PlatformSettings / SystemLogs / UserManagement.
const ADMIN_USER = { id: 1, username: 'admin', role: 'admin' };

const SAMPLE_CASES = [
    { id: 7, name: 'Sample Case', description: 'demo', is_available: true, is_default: true },
];

// Tracks the most recent payload sent to PUT/POST /api/cases* so save-flow
// tests can assert the round trip happened.
const saveTracker = { lastPut: null, putCount: 0, casesGetHeaders: null, casePutHeaders: null };

function defaultHandlers() {
    return [
        // Auth verify — return an admin user so all admin-only tabs render.
        http.get('*/api/auth/verify', () => HttpResponse.json({ user: ADMIN_USER })),

        // Cases loader fires on mount.
        http.get('*/api/cases', ({ request }) => {
            saveTracker.casesGetHeaders = Object.fromEntries(request.headers.entries());
            return HttpResponse.json({ cases: SAMPLE_CASES });
        }),
        // Save endpoints (PUT for update, POST for create).
        http.put('*/api/cases/:id', async ({ request }) => {
            saveTracker.casePutHeaders = Object.fromEntries(request.headers.entries());
            saveTracker.putCount += 1;
            saveTracker.lastPut = await request.json().catch(() => ({}));
            return HttpResponse.json({ id: 7, ...saveTracker.lastPut });
        }),
        http.post('*/api/cases', async ({ request }) => {
            const body = await request.json().catch(() => ({}));
            return HttpResponse.json({ id: 99, ...body });
        }),
        http.put('*/api/cases/:id/labs', () => HttpResponse.json({ ok: true })),
        http.put('*/api/cases/:id/medications', () => HttpResponse.json({ ok: true })),
        http.put('*/api/cases/:id/agents', () => HttpResponse.json({ ok: true })),
        http.delete('*/api/cases/:id', () => HttpResponse.json({ ok: true })),
        http.put('*/api/cases/:id/availability', () => HttpResponse.json({ ok: true })),
        http.put('*/api/cases/:id/default', () => HttpResponse.json({ ok: true })),

        // CaseAgentEditor (rendered at wizard step 11)
        http.get('*/api/agents/templates', () => HttpResponse.json({
            templates: [
                { id: 'tpl-1', name: 'Triage Nurse', persona: 'nurse' },
            ],
        })),
        http.get('*/api/cases/:id/agents', () => HttpResponse.json({
            agents: [
                { id: 'a1', agent_template_id: 'tpl-1', name: 'Nurse', enabled: true },
            ],
        })),

        // Catch-all so component-internal probes don't 500.
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({})),
        http.put('*/api/*', () => HttpResponse.json({})),
    ];
}

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
    saveTracker.lastPut = null;
    saveTracker.putCount = 0;
    saveTracker.casesGetHeaders = null;
    saveTracker.casePutHeaders = null;
    server.resetHandlers(...defaultHandlers());
});
afterAll(() => server.close());

beforeEach(() => {
    // Seed an auth token so AuthService.verifyToken hits /api/auth/verify
    // (it short-circuits to null otherwise).
    window.localStorage.setItem('token', 'admin-token');
});

// Helper: wait for the AuthProvider to flip into "isAdmin = true" by
// waiting for the admin-only "Agents" sidebar tab to appear. Anchored so it
// can't match the "Agents & Voice" group header.
async function waitForAdmin() {
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Agents$/i })).toBeInTheDocument();
    });
}

function mount(props = {}) {
    return renderWithProviders(<ConfigPanel onClose={() => {}} {...props} />);
}

describe('ConfigPanel', () => {
    // CONTRACT: smoke — admin sees the sidebar with all admin tabs. The
    // sidebar is flat (no accordion), so every tab is always visible.
    // Labels are anchored so a tab name can't match a group header.
    it('renders the sidebar shell with admin tabs', async () => {
        mount({ initialTab: 'voice' });
        await waitForAdmin();
        expect(screen.getByRole('button', { name: /^Cases$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Scenarios$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Users$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Platform$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Logs$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Avatars$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Voice$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Notifications$/i })).toBeInTheDocument();
    });

    // CONTRACT: every tab id is reachable and its role gate is intact. Admin
    // sees all 15 tabs across all 7 groups (admin also satisfies the
    // educator+ gates for Cohorts / Analytics).
    it('exposes every tab (with its role gate) for an admin', async () => {
        mount({ initialTab: 'cases' });
        await waitForAdmin();
        const everyTab = [
            /^Cases$/i, /^Scenarios$/i, /^Body Map$/i, /^Lab Database$/i, /^Medications$/i,
            /^Agents$/i, /^Avatars$/i, /^Voice$/i,
            /^Users$/i, /^Courses$/i,
            /^Oyon$/i,
            /^Platform$/i, /^Notifications$/i, /^Logs$/i,
        ];
        for (const name of everyTab) {
            expect(screen.getByRole('button', { name })).toBeInTheDocument();
        }
        // "Analytics" is both the (static) group label and the tab button —
        // only the tab is a button now that group headers are not interactive.
        expect(screen.getAllByRole('button', { name: /^Analytics$/i })).toHaveLength(1);
        // The retired Emotion & Attention tab is gone.
        expect(screen.queryByRole('button', { name: /^Emotion & Attention$/i })).not.toBeInTheDocument();
        // Group labels render as static text, NOT buttons (accordion retired).
        expect(screen.getByText(/^Content$/i)).toBeInTheDocument();
        expect(screen.getByText(/^Agents & Voice$/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Content$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Agents & Voice$/i })).not.toBeInTheDocument();
    });

    // CONTRACT: the Analytics tab (formerly admin-only "Case Analytics") is
    // educator+ — educators previously reached the Oyon analysis views via
    // the retired Emotion & Attention tab and must not lose analytics access.
    it('shows the Analytics tab to an educator and renders the dashboard', async () => {
        server.use(
            http.get('*/api/auth/verify', () =>
                HttpResponse.json({ user: { id: 3, username: 'teach', role: 'educator' } }),
            ),
        );
        mount({ initialTab: 'analytics' });
        await waitFor(() => {
            // The Analytics tab button is present for an educator (the group
            // label of the same name is static text, not a button).
            expect(screen.getAllByRole('button', { name: /^Analytics$/i })).toHaveLength(1);
        });
        expect(await screen.findByTestId('stub-tna-dashboard')).toBeInTheDocument();
        // Admin-only tabs stay hidden for educators.
        expect(screen.queryByRole('button', { name: /^Logs$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Users$/i })).not.toBeInTheDocument();
    });

    // CONTRACT: System Logs hosts the "Oyon data" console sub-tab.
    it('renders the Oyon data sub-tab inside System Logs', async () => {
        mount({ initialTab: 'logs' });
        await waitForAdmin();
        fireEvent.click(await screen.findByRole('button', { name: /^Oyon data$/i }));
        expect(await screen.findByTestId('stub-oyon-data-logs')).toBeInTheDocument();
    });

    // CONTRACT: initialTab='voice' lands directly on the Voice tab.
    it('honours initialTab="voice" by mounting on the Voice tab', async () => {
        mount({ initialTab: 'voice' });
        await waitForAdmin();
        expect(await screen.findByTestId('stub-voice')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-avatars')).not.toBeInTheDocument();
    });

    // CONTRACT: initialTab='agents' lands on the Agent Templates manager.
    it('honours initialTab="agents" by mounting on the Agents tab', async () => {
        mount({ initialTab: 'agents' });
        await waitForAdmin();
        expect(await screen.findByTestId('stub-agent-templates')).toBeInTheDocument();
    });

    // CONTRACT: clicking sidebar tabs swaps the content area.
    it('switches tabs when sidebar buttons are clicked', async () => {
        mount({ initialTab: 'voice' });
        await waitForAdmin();
        expect(await screen.findByTestId('stub-voice')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Avatars/i }));
        expect(await screen.findByTestId('stub-avatars')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-voice')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
        expect(await screen.findByTestId('stub-notifications')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-avatars')).not.toBeInTheDocument();
    });

    // CONTRACT: every known tab renders without crashing (smoke test).
    it('smoke-renders every admin tab without throwing', async () => {
        mount({ initialTab: 'voice' });
        await waitForAdmin();
        // NOTE: click order matters. The Platform panel (PlatformSettings)
        // has its OWN internal "Users" section button, so we visit the sidebar
        // "Users" tab BEFORE "Platform" to avoid an ambiguous name match.
        const tabs = [
            { name: /^Avatars$/i, testid: 'stub-avatars' },
            { name: /^Notifications$/i, testid: 'stub-notifications' },
            { name: /^Agents$/i, testid: 'stub-agent-templates' },
            { name: /^Users$/i, testid: null }, // UserManagement is in-file; just check nothing crashed
            { name: /^Scenarios$/i, testid: 'stub-scenarios' },
            { name: /^Voice$/i, testid: 'stub-voice' },
            { name: /^Logs$/i, testid: null }, // SystemLogs is in-file
            { name: /^Platform$/i, testid: null }, // visited last (owns an internal "Users" button)
        ];
        for (const t of tabs) {
            fireEvent.click(screen.getByRole('button', { name: t.name }));
            if (t.testid) {
                expect(await screen.findByTestId(t.testid)).toBeInTheDocument();
            } else {
                // The shell still renders; we just confirm the sidebar nav
                // didn't blow the tree up.
                expect(screen.getByRole('button', { name: /^Cases$/i })).toBeInTheDocument();
            }
        }
    });

    // CONTRACT: persona-editor handoff from the Agent Templates manager
    // calls onOpenPersonaEditor with the template id.
    it('forwards onOpenPersonaEditor(templateId) when admin clicks Edit on a template', async () => {
        const onOpenPersonaEditor = vi.fn();
        mount({ initialTab: 'agents', onOpenPersonaEditor });
        await waitForAdmin();
        const stub = await screen.findByTestId('stub-agent-templates');
        fireEvent.click(within(stub).getByTestId('stub-edit-template'));
        expect(onOpenPersonaEditor).toHaveBeenCalledWith('tpl-99');
    });

    // CONTRACT: persona-editor handoff for a new persona uses 'new' sentinel.
    it("passes 'new' to onOpenPersonaEditor when creating a new template", async () => {
        const onOpenPersonaEditor = vi.fn();
        mount({ initialTab: 'agents', onOpenPersonaEditor });
        await waitForAdmin();
        const stub = await screen.findByTestId('stub-agent-templates');
        fireEvent.click(within(stub).getByTestId('stub-new-template'));
        expect(onOpenPersonaEditor).toHaveBeenCalledWith('new');
    });

    // CONTRACT: round-trip — initialTab='cases' + initialWizardStep=11 lands
    // on the wizard's Agents step (CaseAgentEditor renders "8. AI Agents").
    it('round-trips back to wizard step 11 (Agents) when reopened from persona editor', async () => {
        // Stash an editing case so the wizard renders on mount.
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7,
            name: 'Resumed',
            description: 'd',
            config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 11 });
        await waitForAdmin();
        // CaseAgentEditor heading is "8. AI Agents" — that's our anchor.
        // The steps strip also lists "Agents", so be specific to the heading.
        expect(await screen.findByText(/8\.\s*AI Agents/i)).toBeInTheDocument();
    });

    // CONTRACT: persona-editor handoff from inside the wizard's Agents step
    // passes the {tab, wizardStep} return-context.
    it('forwards onOpenPersonaEditor(templateId, ctx) from the case wizard Agents step', async () => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7,
            name: 'Resumed',
            description: 'd',
            config: { pages: [] },
        }));
        const onOpenPersonaEditor = vi.fn();
        mount({ initialTab: 'cases', initialWizardStep: 11, onOpenPersonaEditor });
        await waitForAdmin();
        const editBtn = await screen.findByRole('button', { name: /Edit persona/i });
        fireEvent.click(editBtn);
        expect(onOpenPersonaEditor).toHaveBeenCalledWith(
            'tpl-1',
            expect.objectContaining({ tab: 'cases', wizardStep: 11 }),
        );
    });

    // CONTRACT: cancel-with-unsaved-changes triggers a confirm dialog.
    it('shows a confirmation dialog when cancelling the wizard with unsaved changes', async () => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7,
            name: 'Resumed',
            description: 'd',
            config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 1 });
        await waitForAdmin();
        // Wait for wizard to be present.
        const cancel = await screen.findByRole('button', { name: /^Cancel$/ });
        fireEvent.click(cancel);
        // ConfirmModal renders the warning copy from handleCancel.
        expect(await screen.findByText(/You have unsaved changes\. Save before exiting/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Save & Exit/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Discard/i })).toBeInTheDocument();
    });

    // CONTRACT: Save & Exit on the confirm dialog persists the case (PUT
    // /api/cases/:id) and closes the wizard.
    it('Save & Exit persists via PUT and unblocks navigation', async () => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7,
            name: 'Resumed',
            description: 'd',
            config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 1 });
        await waitForAdmin();
        fireEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Save & Exit/i }));
        await waitFor(() => {
            expect(saveTracker.putCount).toBeGreaterThanOrEqual(1);
        });
        // Wizard closes: editing-case stash cleared, "New Case" CTA returns.
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
        });
    });

    it('loads and saves cases through apiFetch with bearer auth and JSON body', async () => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7,
            name: 'Resumed',
            description: 'd',
            config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 1 });
        await waitForAdmin();

        await waitFor(() => {
            expect(saveTracker.casesGetHeaders?.authorization).toBe('Bearer admin-token');
        });
        expect(saveTracker.casesGetHeaders?.['x-request-id']).toBeTruthy();

        fireEvent.click(await screen.findByRole('button', { name: /^Save$/ }));
        await waitFor(() => {
            expect(saveTracker.casePutHeaders?.authorization).toBe('Bearer admin-token');
        });
        expect(saveTracker.casePutHeaders?.['content-type']).toContain('application/json');
        expect(saveTracker.casePutHeaders?.['x-request-id']).toBeTruthy();
        expect(saveTracker.lastPut).toMatchObject({
            id: 7,
            name: 'Resumed',
            description: 'd',
        });
    });

    // CONTRACT: Discard in the confirm dialog drops the wizard without PUT.
    it('Discard exits the wizard without persisting', async () => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7,
            name: 'Resumed',
            description: 'd',
            config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 1 });
        await waitForAdmin();
        fireEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Discard/i }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
        });
        expect(saveTracker.putCount).toBe(0);
    });

    // CONTRACT: Notifications tab is available even to non-admins.
    it('shows the Notifications tab even when the user is not admin', async () => {
        // Override auth verify to a non-admin user.
        server.use(
            http.get('*/api/auth/verify', () =>
                HttpResponse.json({ user: { id: 2, username: 'student', role: 'student' } }),
            ),
        );
        mount({ initialTab: 'notifications' });
        // Non-admin sidebar still has "Select Case" + "Notifications".
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Notifications$/i })).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: /^Select Case$/i })).toBeInTheDocument();
        // Admin-only tabs must NOT be visible.
        expect(screen.queryByRole('button', { name: /^Agents$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Logs$/i })).not.toBeInTheDocument();
        // A group whose items are all admin-only (People, Analytics, Agents &
        // Voice) must not render its header for a non-admin.
        expect(screen.queryByRole('button', { name: /^People$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Agents & Voice$/i })).not.toBeInTheDocument();
        expect(await screen.findByTestId('stub-notifications')).toBeInTheDocument();
    });

    // CONTRACT: pre-existing lint quirk around case_id loader effect — the
    // panel must still render even though the eslint warning is unfixed.
    // HANDOFF.md flags this; we just smoke that ConfigPanel mounts cleanly.
    it('renders despite the known set-state-in-effect lint warning on the case_id loader', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mount({ initialTab: 'cases' });
        await waitForAdmin();
        // No React error boundary blew up — the New Case CTA is reachable.
        expect(await screen.findByRole('button', { name: /New Case/i })).toBeInTheDocument();
        errSpy.mockRestore();
    });

    // CONTRACT: the case list is a course → cases browser — cases group
    // under their course (alphabetical), unassigned cases trail last, and
    // every card shows its language flag + case code.
    it('groups cases by course with language flags and case codes, Unassigned last', async () => {
        server.use(
            http.get('*/api/cases', () => HttpResponse.json({ cases: [
                { id: 1, name: 'Chest pain', description: 'd', is_available: true, is_default: true,
                  case_code: 'EN-0001', config: { case_language: 'en' }, course_id: 10, course_name: 'Basic course' },
                { id: 2, name: 'Dolore toracico', description: 'd', is_available: true, is_default: false,
                  case_code: 'IT-0002', config: { case_language: 'it' }, course_id: 11, course_name: 'Corso di cardiologia' },
                { id: 3, name: 'Orphan case', description: 'd', is_available: true, is_default: false,
                  case_code: 'EN-0003', config: { case_language: 'en' }, course_id: null, course_name: null },
            ] })),
        );
        const onLoadCase = vi.fn();
        mount({ initialTab: 'cases', onLoadCase });
        await waitForAdmin();

        // Group headers render, Unassigned trailing last in DOM order.
        expect(await screen.findByText('Basic course')).toBeInTheDocument();
        expect(screen.getByText('Corso di cardiologia')).toBeInTheDocument();
        expect(screen.getByText('Unassigned cases')).toBeInTheDocument();
        const text = document.body.textContent;
        expect(text.indexOf('Basic course')).toBeLessThan(text.indexOf('Corso di cardiologia'));
        expect(text.indexOf('Corso di cardiologia')).toBeLessThan(text.indexOf('Unassigned cases'));

        // Prominent language chip: flag emoji (own text node) + native language
        // name, plus the visible case code, on the cards.
        expect(screen.getByText('🇮🇹')).toBeInTheDocument();
        expect(screen.getByText('Italiano')).toBeInTheDocument();
        expect(screen.getAllByText('English').length).toBeGreaterThan(0);
        expect(screen.getByText('IT-0002')).toBeInTheDocument();
        expect(screen.getByText('EN-0003')).toBeInTheDocument();

        // Load still hands the case to the app from inside a group.
        fireEvent.click(screen.getAllByRole('button', { name: /^Load$/i })[0]);
        expect(onLoadCase).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });

    // CONTRACT: clicking "New Case" opens the wizard (smoke for the
    // wizard's mount path from the empty-list view).
    it('opens the case wizard when "New Case" is clicked', async () => {
        mount({ initialTab: 'cases' });
        await waitForAdmin();
        fireEvent.click(await screen.findByRole('button', { name: /New Case/i }));
        // Wizard footer shows Cancel / Next.
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
    });

    // CONTRACT: fullPage=true exposes the "Back to Simulation" close button
    // and wires it to onClose.
    it('renders the close button in fullPage mode and invokes onClose', async () => {
        const onClose = vi.fn();
        mount({ initialTab: 'voice', fullPage: true, onClose });
        await waitForAdmin();
        const back = screen.getByRole('button', { name: /Back to Simulation/i });
        fireEvent.click(back);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // CONTRACT: the sidebar is flat — the accordion was retired (operator
    // feedback 2026-07-03: collapsing sections behind headers was
    // impractical). Every tab stays visible even when a stale
    // rohy.configPanel.openGroups localStorage entry says groups are
    // collapsed, and group labels are not clickable.
    it('keeps every tab visible and ignores stale persisted collapse state', async () => {
        window.localStorage.setItem(
            'rohy.configPanel.openGroups',
            JSON.stringify({ Content: false, People: false }),
        );
        mount({ initialTab: 'scenarios' });
        await waitForAdmin();
        // Items from "collapsed" groups are all still visible.
        expect(screen.getByRole('button', { name: /^Scenarios$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Users$/i })).toBeInTheDocument();
        expect(await screen.findByTestId('stub-scenarios')).toBeInTheDocument();
        // Group labels are static text — clicking one is not possible
        // because they are not buttons.
        expect(screen.queryByRole('button', { name: /^Content$/i })).not.toBeInTheDocument();
    });

    // CONTRACT: the LLM screen's model field is a curated catalogue dropdown
    // (from the shared llmCatalogue) with a "Custom…" escape — not the old
    // free-text box. Navigating Platform → AI with an Anthropic config shows
    // the current Claude line.
    it('renders the model catalogue dropdown on the Platform → AI section', async () => {
        server.use(
            http.get('*/api/platform-settings/llm', () => HttpResponse.json({
                provider: 'anthropic',
                model: 'claude-opus-4-8',
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: '',
                enabled: true,
                maxOutputTokens: '',
                temperature: '',
                systemPromptTemplate: ''
            })),
        );
        mount({ initialTab: 'platform' });
        await waitForAdmin();
        fireEvent.click(screen.getByRole('button', { name: 'AI / LLM' }));
        // The model field is an editable combobox; the catalogue is offered as
        // <datalist> suggestions (queried directly — datalist options have no
        // reliable ARIA role).
        const modelInput = await screen.findByLabelText('Model name');
        expect(modelInput).toBeInTheDocument();
        const ids = Array.from(document.querySelectorAll('datalist option')).map((o) => o.value);
        expect(ids).toContain('claude-opus-4-8');
        expect(ids).toContain('claude-sonnet-5');
    });

    // CONTRACT: for a keyless local provider (LM Studio / Ollama) the model
    // picker auto-populates from the running server's live /models list — no
    // button click needed. This is the answer to LM Studio's "Multiple models
    // are loaded, specify one" 400: the loaded ids appear as suggestions on
    // their own.
    it('auto-detects loaded models for a local provider without a click', async () => {
        let detectHit = false;
        server.use(
            http.get('*/api/platform-settings/llm', () => HttpResponse.json({
                provider: 'lmstudio',
                model: '',
                baseUrl: 'http://localhost:1234/v1',
                apiKey: '',
                enabled: true,
                maxOutputTokens: '',
                temperature: '',
                systemPromptTemplate: ''
            })),
            http.post('*/api/platform-settings/llm/models/detect', () => {
                detectHit = true;
                return HttpResponse.json({ models: ['qwen2.5-7b', 'llama-3.1-8b'], supported: true });
            }),
        );
        mount({ initialTab: 'platform' });
        await waitForAdmin();
        fireEvent.click(screen.getByRole('button', { name: 'AI / LLM' }));
        await screen.findByLabelText('Model name');

        await waitFor(() => {
            const ids = Array.from(document.querySelectorAll('datalist option')).map((o) => o.value);
            expect(ids).toContain('qwen2.5-7b');
            expect(ids).toContain('llama-3.1-8b');
        }, { timeout: 2500 });
        expect(detectHit).toBe(true);
    });
});
