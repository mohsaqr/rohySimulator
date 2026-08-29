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

    // Regression lock: the wizard footer derives the last step from
    // WIZARD_STEPS, not a literal.
    //
    // The footer used `step < 9` while WIZARD_STEPS had grown to 11, so the
    // linear path dead-ended at Records: step 9 offered "Save & Finish"
    // (which closes the wizard) with Treatments and Agents still ahead, and
    // those two steps had no forward control at all. Reported 2026-08-06 by
    // an author on an iPad, where the step strip also overflowed off-screen
    // and the footer was the only way through.
    it.each([
        [8, 'Exam'],
        [9, 'Records'],
        [10, 'Treatments'],
    ])('offers Next (not Save & Finish) on wizard step %i (%s)', async (stepNum) => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7, name: 'Resumed', description: 'd', config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: stepNum });
        await waitForAdmin();
        expect(await screen.findByRole('button', { name: /^Next$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Save & Finish/i })).not.toBeInTheDocument();
    });

    // CONTRACT: "Save & Finish" marks the LAST step and nothing else, so the
    // linear path through the wizard cannot dead-end early. The final step was
    // Agents (11) until v2.9.73 added Plugins (12); the invariant is the point,
    // not which step happens to be last.
    it('offers Save & Finish only on the final wizard step', async () => {
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7, name: 'Resumed', description: 'd', config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 12 });
        await waitForAdmin();
        expect(await screen.findByRole('button', { name: /Save & Finish/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Next$/i })).not.toBeInTheDocument();
    });

    it('still offers Next on the step before the last', async () => {
        // The other half of the same invariant: adding a step must not strand
        // the one before it, which is exactly what a hardcoded last-step number
        // did the last time the wizard grew (see the footer comment).
        window.localStorage.setItem('rohy_editing_case', JSON.stringify({
            id: 7, name: 'Resumed', description: 'd', config: { pages: [] },
        }));
        mount({ initialTab: 'cases', initialWizardStep: 11 });
        await waitForAdmin();
        expect(await screen.findByRole('button', { name: /^Next$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Save & Finish/i })).not.toBeInTheDocument();
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

    // Regression lock: the default course header rendered the raw seeded
    // English literal "Basic course" in every UI language, because the name
    // was a functional identifier (matched by the boot seeder) and could not
    // be localised. GET /cases now carries `course_is_default`; while the
    // default course still bears the seeded literal, the header renders the
    // translated `default_course_name` catalogue entry. A renamed default
    // (or a non-default course that happens to be called "Basic course")
    // shows its stored name verbatim.
    it('renders the seeded default course header through the UI language (it → "Corso base")', async () => {
        server.use(
            http.get('*/api/cases', () => HttpResponse.json({ cases: [
                { id: 1, name: 'Chest pain', description: 'd', is_available: true, is_default: true,
                  case_code: 'EN-0001', config: { case_language: 'en' },
                  course_id: 10, course_name: 'Basic course', course_is_default: 1 },
                { id: 2, name: 'Dolore toracico', description: 'd', is_available: true, is_default: false,
                  case_code: 'IT-0002', config: { case_language: 'it' },
                  course_id: 11, course_name: 'Corso di cardiologia', course_is_default: 0 },
            ] })),
        );
        const { setAppLanguage } = await import('../../i18n');
        await setAppLanguage('it');
        try {
            mount({ initialTab: 'cases' });
            expect(await screen.findByText('Corso base')).toBeInTheDocument();
            expect(screen.queryByText('Basic course')).not.toBeInTheDocument();
            expect(screen.getByText('Corso di cardiologia')).toBeInTheDocument();
        } finally {
            await setAppLanguage('en');
        }
    });

    it('shows a RENAMED default course verbatim, and a non-default "Basic course" verbatim', async () => {
        server.use(
            http.get('*/api/cases', () => HttpResponse.json({ cases: [
                { id: 1, name: 'Chest pain', description: 'd', is_available: true, is_default: true,
                  case_code: 'EN-0001', config: { case_language: 'en' },
                  course_id: 10, course_name: 'Cardiology 101', course_is_default: 1 },
                { id: 2, name: 'Dolore toracico', description: 'd', is_available: true, is_default: false,
                  case_code: 'IT-0002', config: { case_language: 'it' },
                  course_id: 11, course_name: 'Basic course', course_is_default: 0 },
            ] })),
        );
        const { setAppLanguage } = await import('../../i18n');
        await setAppLanguage('it');
        try {
            mount({ initialTab: 'cases' });
            expect(await screen.findByText('Cardiology 101')).toBeInTheDocument();
            // The teacher-made course merely NAMED "Basic course" is not the
            // default and must not be translated.
            expect(screen.getByText('Basic course')).toBeInTheDocument();
            expect(screen.queryByText('Corso base')).not.toBeInTheDocument();
        } finally {
            await setAppLanguage('en');
        }
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

describe('ConfigPanel — wizard deep-link step derivation (source contract)', () => {
    // Regression lock: repository-select sent teachers to Story, not Scenario
    // (bug report 2.9.15 #2). The handler hardcoded `setWizardInitialStep(3)`
    // — index 3 WAS Scenario until the Avatar step was inserted, after which
    // 3 = Story and 4 = Scenario. Same off-by-one class as the 2.9.17 lastStep
    // fix (which derived the footer's last step from WIZARD_STEPS); this call
    // site was missed. Driving the full browse-repository → wizard flow
    // behaviorally needs the un-stubbed ScenarioRepository, so we lock the
    // source contract instead, mirroring PatientMonitor.test.jsx.
    async function readSource() {
        const fs = await import('node:fs');
        const path = await import('node:path');
        return fs.readFileSync(path.resolve(__dirname, 'ConfigPanel.jsx'), 'utf8');
    }

    it('derives the repository-select target step from the step table, never a literal', async () => {
        const src = await readSource();
        // The handler goes through the step-key lookup…
        expect(src).toMatch(/setWizardInitialStep\(wizardStepNumber\('scenario'\)\)/);
        // …and no call site passes a numeric literal except the consumed-once
        // reset to 1 (onStepLoaded).
        const args = [...src.matchAll(/setWizardInitialStep\(([^)]*)\)/g)].map((m) => m[1].trim());
        expect(args.length).toBeGreaterThan(0);
        for (const arg of args) {
            if (/^\d+$/.test(arg)) expect(arg).toBe('1');
        }
    });

    it('keeps WIZARD_STEPS and wizardStepNumber on the same WIZARD_STEP_KEYS list', async () => {
        const src = await readSource();
        // One ordered key list exists, with scenario AFTER avatar + story
        // (the 2.9.15 regression was exactly this ordering changing).
        const keysMatch = src.match(/const WIZARD_STEP_KEYS = \[([^\]]*)\]/);
        expect(keysMatch).toBeTruthy();
        const keys = [...keysMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
        expect(keys.indexOf('scenario')).toBe(3); // 1-based step 4
        expect(keys.indexOf('avatar')).toBe(1);
        expect(keys.indexOf('story')).toBe(2);
        // The rendered step table is BUILT from that list, so they can't drift.
        expect(src).toMatch(/WIZARD_STEP_KEYS\.map\(\(key, i\) => \(\{ num: i \+ 1/);
    });
});

describe('ConfigPanel — body-map preview upload visibility (source contract)', () => {
    // Regression lock: body-image upload wrote to unserved public/ root (bug report 2.9.15 #13)
    // The previews were static `./man-front.png` bundle paths with no
    // cache-buster — even a correctly stored upload never repainted. They now
    // go through BodyImagePreview (useBodyImage: uploaded URL first, onError
    // fallback to the bundled default via baseUrl, versioned cache-buster).
    //
    // The four hand-copied slot blocks were collapsed into <BodyImageSlot> when
    // the reset-to-default action landed (2.9.37 report, bug 4), so the version
    // now reaches the preview through one hop. The lock follows the indirection
    // rather than relaxing: every slot must still pass the cache-buster, and
    // the slot must still hand it to BodyImagePreview.
    it('renders previews through BodyImagePreview, not relative bundle paths', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(path.resolve(__dirname, 'ConfigPanel.jsx'), 'utf8');
        expect(src).not.toMatch(/src="\.\/(man|woman)-(front|back)\.png"/);
        for (const type of ['man-front', 'man-back', 'woman-front', 'woman-back']) {
            expect(src).toMatch(new RegExp(`<BodyImageSlot\\s+type="${type}"`));
        }
        // Every slot passes the versioned cache-buster down…
        expect(src.match(/version=\{bodyImageVersion\}/g) ?? []).toHaveLength(4);
        // …and the slot is what feeds BodyImagePreview.
        expect(src).toMatch(/<BodyImagePreview type=\{type\} version=\{version\}/);
    });

    // Regression lock: an uploaded silhouette could not be reverted to the
    // bundled default (2.9.37 report, bug 4). The reset is a DELETE of the
    // override — useBodyImage() then falls through to /<type>.png on its own.
    it('offers a reset-to-default action that DELETEs the override', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(path.resolve(__dirname, 'ConfigPanel.jsx'), 'utf8');
        expect(src).toMatch(/apiFetch\(`\/body-image\/\$\{type\}`, \{ method: 'DELETE' \}\)/);
        // The preview must re-probe afterwards or the browser repaints the
        // cached override and the reset looks like it did nothing.
        expect(src).toMatch(/resetBodyImage[\s\S]{0,400}setBodyImageVersion\(Date\.now\(\)\)/);
        // All four slots get the action, not just the first.
        expect(src.match(/onReset=\{resetBodyImage\}/g) ?? []).toHaveLength(4);
    });
});
