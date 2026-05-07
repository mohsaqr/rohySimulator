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
vi.mock('../monitor/EventLog.jsx', () => ({
    default: () => <div data-testid="stub-event-log">event-log</div>,
}));
vi.mock('../analytics/SessionLogViewer.jsx', () => ({
    default: () => <div data-testid="stub-session-log">session-log</div>,
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
// waiting for the admin-only "Agent Personas" sidebar button to appear.
async function waitForAdmin() {
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Agent Personas/i })).toBeInTheDocument();
    });
}

function mount(props = {}) {
    return renderWithProviders(<ConfigPanel onClose={() => {}} {...props} />);
}

describe('ConfigPanel', () => {
    // CONTRACT: smoke — admin sees the sidebar with all admin tabs.
    it('renders the sidebar shell with admin tabs', async () => {
        mount({ initialTab: 'voice' });
        await waitForAdmin();
        expect(screen.getByRole('button', { name: /Manage Cases/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Scenarios/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /User Management/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Platform Settings/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /System Logs/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Avatars/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Voice$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Notifications/i })).toBeInTheDocument();
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
        const tabs = [
            { name: /Avatars/i, testid: 'stub-avatars' },
            { name: /Notifications/i, testid: 'stub-notifications' },
            { name: /Agent Personas/i, testid: 'stub-agent-templates' },
            { name: /System Logs/i, testid: null }, // SystemLogs is in-file; just check nothing crashed
            { name: /Platform Settings/i, testid: null },
            { name: /User Management/i, testid: null },
            { name: /Scenarios/i, testid: 'stub-scenarios' },
            { name: /^Voice$/i, testid: 'stub-voice' },
        ];
        for (const t of tabs) {
            fireEvent.click(screen.getByRole('button', { name: t.name }));
            if (t.testid) {
                expect(await screen.findByTestId(t.testid)).toBeInTheDocument();
            } else {
                // The shell still renders; we just confirm the sidebar nav
                // didn't blow the tree up.
                expect(screen.getByRole('button', { name: /Manage Cases/i })).toBeInTheDocument();
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
        // Non-admin sidebar still has "Manage Cases" + "Notifications".
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Notifications/i })).toBeInTheDocument();
        });
        // Admin-only buttons must NOT be visible.
        expect(screen.queryByRole('button', { name: /Agent Personas/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /System Logs/i })).not.toBeInTheDocument();
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
});
