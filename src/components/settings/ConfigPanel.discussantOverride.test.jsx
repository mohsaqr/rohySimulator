// Regression lock: saving a case agent's overrides must PRESERVE the keys the
// panel does not edit.
//
// `config_override` is a FULL REPLACE server-side. The save handler used to
// rebuild the blob from three controls only, so any save — even one that
// touched nothing — dropped every other key. v2.9.98's `show_encounter_record`
// was therefore switched back off by the next save of any field
// (2026-08-30 UI review, #12; the render half was already fixed in v2.9.101).
//
// This file is a sibling of ConfigPanel.test.jsx and must not touch it: it
// mounts the case wizard straight onto the Agents step (step 11), opens the
// discussant's "Case overrides" editor, saves without touching a control, and
// reads the PUT body off the wire.

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// Heavy sibling tabs are never reached on the cases tab, but ConfigPanel
// imports them eagerly — stub the ones that pull 3D/audio/analytics weight.
vi.mock('./AgentTemplateManager.jsx', () => ({ default: () => <div /> }));
vi.mock('./AvatarsSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./VoiceSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./NotificationsSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./ScenarioRepository.jsx', () => ({ default: () => <div /> }));

import ConfigPanel from './ConfigPanel.jsx';

const ADMIN_USER = { id: 1, username: 'admin', role: 'admin' };

// The merged config GET /cases/:id/agents returns: template config plus the
// case's own override. `show_encounter_record` is the key at risk — nothing in
// the three discussant controls touches it.
const DISCUSSANT = {
    id: 'a-discussant',
    agent_template_id: 'tpl-discussant',
    agent_type: 'discussant',
    name: 'Debrief Tutor',
    role_title: 'Case debrief tutor',
    enabled: true,
    availability_type: 'present',
    available_from_minute: 0,
    depart_at_minute: null,
    response_time_min: 0,
    response_time_max: 0,
    context_filter: 'full',
    config: {
        context_filter: 'history',
        unlock_trigger: 'always',
        show_encounter_record: true,
        // A key no control in this panel knows about at all.
        tone: 'socratic',
    },
    has_config_override: true,
};

const wire = { lastAgentPut: null };

function defaultHandlers() {
    return [
        http.get('*/api/auth/verify', () => HttpResponse.json({ user: ADMIN_USER })),
        http.get('*/api/cases', () => HttpResponse.json({ cases: [] })),
        http.get('*/api/agents/templates', () => HttpResponse.json({
            templates: [{ id: 'tpl-discussant', name: 'Debrief Tutor', persona: 'discussant' }],
        })),
        http.get('*/api/cases/:id/agents', () => HttpResponse.json({ agents: [DISCUSSANT] })),
        http.put('*/api/cases/:caseId/agents/:agentId', async ({ request }) => {
            wire.lastAgentPut = await request.json().catch(() => ({}));
            return HttpResponse.json({ ok: true });
        }),
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({})),
        http.put('*/api/*', () => HttpResponse.json({})),
        http.delete('*/api/*', () => HttpResponse.json({})),
    ];
}

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
    window.localStorage.setItem('token', 'admin-token');
    window.localStorage.setItem('rohy_editing_case', JSON.stringify({
        id: 7, name: 'Resumed', description: 'd', config: { pages: [] },
    }));
});
afterEach(() => {
    wire.lastAgentPut = null;
    window.localStorage.clear();
    server.resetHandlers(...defaultHandlers());
});
afterAll(() => server.close());

async function openDiscussantOverrides() {
    renderWithProviders(
        <ConfigPanel onClose={() => {}} initialTab="cases" initialWizardStep={11} />
    );
    const overridesBtn = await screen.findByRole('button', { name: /Case overrides/i }, { timeout: 5000 });
    fireEvent.click(overridesBtn);
    // The discussant-only block is the proof we're in the right editor.
    await screen.findByText(/Show the encounter record at debrief/i);
}

describe('ConfigPanel — discussant case overrides survive a save', () => {
    // Regression lock: a save that touches none of the three discussant
    // controls must keep show_encounter_record (and every other stored key).
    it('preserves show_encounter_record when saving without touching the controls', async () => {
        await openDiscussantOverrides();

        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => expect(wire.lastAgentPut).not.toBeNull(), { timeout: 5000 });
        expect(wire.lastAgentPut.config_override).toMatchObject({
            show_encounter_record: true,
            context_filter: 'history',
            unlock_trigger: 'always',
            // Even a key this panel has never heard of survives the round-trip.
            tone: 'socratic',
        });
    });

    // The panel must still be able to CHANGE what it does edit — a spread
    // that only ever preserves would be its own bug.
    it('still writes an edited control through, without dropping the rest', async () => {
        await openDiscussantOverrides();

        const checkbox = screen.getByRole('checkbox', { checked: true });
        fireEvent.click(checkbox); // turn the encounter record OFF
        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => expect(wire.lastAgentPut).not.toBeNull(), { timeout: 5000 });
        expect(wire.lastAgentPut.config_override.show_encounter_record).toBe(false);
        expect(wire.lastAgentPut.config_override.tone).toBe('socratic');
    });
});
