// The on-call specialist's disclosure gate, in the case-agent editor.
//
// Regression lock: until 2026-09-18 this panel had NO specialist block at all.
// `config_override.disclosure` — findings mode, minStudentTurns,
// requireRoomActivity — decides when a specialist will confirm what the
// material shows, and it was reachable only by hand-writing the override
// through the API, so every case in the product ran on the registry default.
//
// It also locks two things the discussant block got wrong once already:
//   - config_override is a FULL REPLACE, so keys this panel does not edit
//     must survive a save (the show_encounter_record bug, 2026-08-30 #12);
//   - the disclosure block itself is REBUILT rather than spread, so a stored
//     `requireInterpretation` from before that field was removed cannot ride
//     along and make the server refuse the whole PUT.
//
// A sibling of ConfigPanel.test.jsx and ConfigPanel.discussantOverride.test.jsx;
// it must not touch either.

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

vi.mock('./AgentTemplateManager.jsx', () => ({ default: () => <div /> }));
vi.mock('./AvatarsSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./VoiceSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./NotificationsSettingsTab.jsx', () => ({ default: () => <div /> }));
vi.mock('./ScenarioRepository.jsx', () => ({ default: () => <div /> }));

import ConfigPanel from './ConfigPanel.jsx';

const ADMIN_USER = { id: 1, username: 'admin', role: 'admin' };

// The merged config GET /cases/:id/agents returns. `voice` is a key no control
// in this panel knows about; `requireInterpretation` is the removed field that
// a case authored before 2026-09-18 would still carry.
const makeSpecialist = (disclosure) => ({
    id: 'a-path',
    agent_template_id: 'tpl-path',
    agent_type: 'pathologist',
    name: 'On-call Pathologist',
    role_title: 'Pathologist',
    enabled: true,
    availability_type: 'on-call',
    available_from_minute: 0,
    depart_at_minute: null,
    response_time_min: 0,
    response_time_max: 0,
    config: { voice: { case_voice: 'bf_emma' }, disclosure },
    has_config_override: true,
});

const wire = { lastAgentPut: null };
let agent = makeSpecialist({ findings: 'after_effort', minStudentTurns: 3, requireRoomActivity: true });

function defaultHandlers() {
    return [
        http.get('*/api/auth/verify', () => HttpResponse.json({ user: ADMIN_USER })),
        http.get('*/api/cases', () => HttpResponse.json({ cases: [] })),
        http.get('*/api/agents/templates', () => HttpResponse.json({
            templates: [{ id: 'tpl-path', name: 'On-call Pathologist', persona: 'pathologist' }],
        })),
        http.get('*/api/cases/:id/agents', () => HttpResponse.json({ agents: [agent] })),
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
    agent = makeSpecialist({ findings: 'after_effort', minStudentTurns: 3, requireRoomActivity: true });
    window.localStorage.clear();
    server.resetHandlers(...defaultHandlers());
});
afterAll(() => server.close());

async function openSpecialistOverrides() {
    renderWithProviders(
        <ConfigPanel onClose={() => {}} initialTab="cases" initialWizardStep={11} />
    );
    const overridesBtn = await screen.findByRole('button', { name: /Case overrides/i }, { timeout: 5000 });
    fireEvent.click(overridesBtn);
    await screen.findByText(/On-call specialist/i);
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
const settled = () => waitFor(() => expect(wire.lastAgentPut).not.toBeNull(), { timeout: 5000 });

describe('ConfigPanel — on-call specialist disclosure', () => {
    it('renders the stored gate rather than the registry default', async () => {
        agent = makeSpecialist({ findings: 'on_request', minStudentTurns: 7, requireRoomActivity: false });
        await openSpecialistOverrides();

        expect(screen.getByLabelText(/Discuss findings/i)).toHaveValue('on_request');
        expect(screen.getByLabelText(/Messages first/i)).toHaveValue(7);
        expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('writes an edited gate through, keeping keys it does not edit', async () => {
        await openSpecialistOverrides();

        fireEvent.change(screen.getByLabelText(/Discuss findings/i), { target: { value: 'never' } });
        save();

        await settled();
        expect(wire.lastAgentPut.config_override.disclosure).toEqual({
            findings: 'never',
            minStudentTurns: 3,
            requireRoomActivity: true,
        });
        // A key this panel has never heard of survives the round-trip.
        expect(wire.lastAgentPut.config_override.voice).toEqual({ case_voice: 'bf_emma' });
    });

    it('turns the room-activity requirement off', async () => {
        await openSpecialistOverrides();

        fireEvent.click(screen.getByRole('checkbox'));
        save();

        await settled();
        expect(wire.lastAgentPut.config_override.disclosure.requireRoomActivity).toBe(false);
    });

    // Regression lock: the registry dropped `requireInterpretation`, and
    // normalizeDisclosure now rejects it as an unknown field. Spreading the
    // stored disclosure block forward would carry it into the PUT and the
    // server would refuse the whole save with `invalid_disclosure` — an
    // educator locked out of a case they never mis-authored.
    it('drops a removed field left over in a case authored before it went', async () => {
        agent = makeSpecialist({
            findings: 'after_effort', minStudentTurns: 2,
            requireRoomActivity: true, requireInterpretation: true,
        });
        await openSpecialistOverrides();

        save();

        await settled();
        expect(wire.lastAgentPut.config_override.disclosure).not.toHaveProperty('requireInterpretation');
        expect(wire.lastAgentPut.config_override.disclosure.minStudentTurns).toBe(2);
    });

    // A half-typed number box must never reach the server as NaN: the route
    // validates minStudentTurns as an integer and would refuse the save.
    it('never sends NaN while the number box is empty', async () => {
        await openSpecialistOverrides();

        fireEvent.change(screen.getByLabelText(/Messages first/i), { target: { value: '' } });
        save();

        await settled();
        expect(Number.isInteger(wire.lastAgentPut.config_override.disclosure.minStudentTurns)).toBe(true);
    });

    // The block belongs to specialists only; a nurse has no disclosure gate.
    it('does not render for a non-specialist agent', async () => {
        agent = { ...makeSpecialist({}), agent_type: 'nurse', name: 'Nurse', config: {} };
        renderWithProviders(
            <ConfigPanel onClose={() => {}} initialTab="cases" initialWizardStep={11} />
        );
        const overridesBtn = await screen.findByRole('button', { name: /Case overrides/i }, { timeout: 5000 });
        fireEvent.click(overridesBtn);
        await screen.findByRole('button', { name: /Save Changes/i });
        expect(screen.queryByText(/On-call specialist/i)).toBeNull();
    });
});
