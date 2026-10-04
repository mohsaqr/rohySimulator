// Regression lock: a learner's case list showed the authoring title and summary, which name the diagnosis (QA 2026-10-04, PRV-21)
//
// Settings > Select Case listed each case by its authoring title ("Acute Chest
// Pain - STEMI") and authoring description ("...ECG shows an acute anterior
// ST-elevation MI..."). A learner now sees the patient's name and chief
// complaint; educators and admins keep the authoring view.
import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

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

const CASES = [{
    id: 7, name: 'Acute Chest Pain - STEMI', description: 'ECG shows an acute anterior ST-elevation MI (proximal LAD occlusion).',
    case_code: 'EN-0001', is_available: true, is_default: true,
    config: { case_language: 'en', patient_name: 'John Martinez', structuredHistory: { chiefComplaint: 'Crushing chest pain' } },
}];

let currentUser;
const server = setupServer(
    http.get('*/api/auth/verify', () => HttpResponse.json({ user: currentUser })),
    http.get('*/api/cases', () => HttpResponse.json({ cases: CASES })),
    http.get('*/api/*', () => HttpResponse.json({})),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => { window.localStorage.setItem('token', 'test-token'); });

describe('ConfigPanel case list — what a learner sees', () => {
    it('shows a student the patient and chief complaint, never the authoring title or summary', async () => {
        currentUser = { id: 2, username: 'student', role: 'student' };
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await waitFor(() => expect(screen.getByText('John Martinez')).toBeInTheDocument());
        expect(screen.getByText('Crushing chest pain')).toBeInTheDocument();
        expect(screen.queryByText(/Acute Chest Pain - STEMI/)).not.toBeInTheDocument();
        expect(screen.queryByText(/ST-elevation/)).not.toBeInTheDocument();
    });

    it('keeps the authoring title and summary for an educator', async () => {
        currentUser = { id: 3, username: 'teacher', role: 'educator' };
        renderWithProviders(<ConfigPanel onClose={() => {}} initialTab="cases" />);
        await waitFor(() => expect(screen.getByText('Acute Chest Pain - STEMI')).toBeInTheDocument());
        expect(screen.getByText(/proximal LAD occlusion/)).toBeInTheDocument();
    });
});
