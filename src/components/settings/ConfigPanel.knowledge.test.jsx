// What an agent knows about the case, in the case-agent editor.
//
// `config_override.knowledge` — scope, answerKey, record — decides what the
// server puts in an agent's prompt before the conversation starts. It is the
// control that replaces `context_filter`, whose per-case override was stored
// and never read by anything.
//
// This locks the five behaviours its sibling ConfigPanel.specialistDisclosure
// test locks, plus the one that is new here: because the knowledge block
// applies to nearly every type while the discussant and specialist blocks
// apply to one each, an agent can now match TWO blocks — so the save must
// ACCUMULATE into one config_override rather than assign it twice.
//
// A sibling of ConfigPanel.test.jsx, ConfigPanel.discussantOverride.test.jsx
// and ConfigPanel.specialistDisclosure.test.jsx; it must not touch any of them.

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
// in this panel knows about, and must survive a save.
const makeAgent = (agentType, config = {}, extra = {}) => ({
    id: 'a-1',
    agent_template_id: 'tpl-1',
    agent_type: agentType,
    name: `The ${agentType}`,
    role_title: agentType,
    enabled: true,
    availability_type: 'on-call',
    available_from_minute: 0,
    depart_at_minute: null,
    response_time_min: 0,
    response_time_max: 0,
    config: { voice: { case_voice: 'bf_emma' }, ...config },
    has_config_override: true,
    ...extra,
});

const wire = { lastAgentPut: null };
let agent = makeAgent('consultant');

function defaultHandlers() {
    return [
        http.get('*/api/auth/verify', () => HttpResponse.json({ user: ADMIN_USER })),
        http.get('*/api/cases', () => HttpResponse.json({ cases: [] })),
        http.get('*/api/agents/templates', () => HttpResponse.json({
            templates: [{ id: 'tpl-1', name: 'Consultant', persona: 'consultant' }],
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
    agent = makeAgent('consultant');
    window.localStorage.clear();
    server.resetHandlers(...defaultHandlers());
});
afterAll(() => server.close());

async function openOverrides({ expectKnowledge = true } = {}) {
    renderWithProviders(
        <ConfigPanel onClose={() => {}} initialTab="cases" initialWizardStep={11} />
    );
    const overridesBtn = await screen.findByRole('button', { name: /Case overrides/i }, { timeout: 5000 });
    fireEvent.click(overridesBtn);
    if (expectKnowledge) await screen.findByText(/What this agent knows about the case/i);
    else await screen.findByRole('button', { name: /Save Changes/i });
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
const settled = () => waitFor(() => expect(wire.lastAgentPut).not.toBeNull(), { timeout: 5000 });
const knowledgeOfPut = () => wire.lastAgentPut?.config_override?.knowledge;

describe('the knowledge block renders what is stored', () => {
    it('shows the stored scope, not the type default', async () => {
        agent = makeAgent('consultant', { knowledge: { scope: 'handover', answerKey: false, record: true } });
        await openOverrides();
        expect(screen.getByDisplayValue(/A shift handover/i)).toBeTruthy();
    });

    // Regression lock: an agent nobody has migrated must render the behaviour
    // it actually has, not the shipped default. `context_filter: 'full'` was
    // the rung that carried the answer key, so it has to come back as the
    // whole chart WITH the key ticked — otherwise reopening the editor and
    // saving would silently narrow a case that was working.
    it('maps the legacy context_filter column when no knowledge is stored', async () => {
        agent = makeAgent('consultant', {}, { context_filter: 'full' });
        await openOverrides();
        expect(screen.getByDisplayValue(/The whole chart/i)).toBeTruthy();
        expect(screen.getByLabelText(/Also give it the expected diagnosis/i).checked).toBe(true);
    });

    it('falls back to the shipped default when there is neither', async () => {
        agent = makeAgent('discussant');
        await openOverrides();
        // The tutor ships with a brief summary and no answer key.
        expect(screen.getByDisplayValue(/A brief summary/i)).toBeTruthy();
        expect(screen.getByLabelText(/Also give it the expected diagnosis/i).checked).toBe(false);
    });
});

describe('the knowledge block writes through', () => {
    it('sends the three fields as a rebuilt block, keeping keys it does not edit', async () => {
        await openOverrides();
        fireEvent.change(screen.getByDisplayValue(/The whole chart/i), { target: { value: 'handover' } });
        save();
        await settled();
        expect(knowledgeOfPut()).toEqual({ scope: 'handover', answerKey: false, record: true });
        // A key this panel has never heard of survives the round-trip.
        expect(wire.lastAgentPut.config_override.voice).toEqual({ case_voice: 'bf_emma' });
    });

    it('writes an OFF explicitly, so a stored true cannot survive the spread', async () => {
        agent = makeAgent('consultant', { knowledge: { scope: 'chart', answerKey: true, record: true } });
        await openOverrides();
        fireEvent.click(screen.getByLabelText(/Also give it the expected diagnosis/i));
        fireEvent.click(screen.getByLabelText(/Tell it what the learner has done/i));
        save();
        await settled();
        expect(knowledgeOfPut()).toEqual({ scope: 'chart', answerKey: false, record: false });
    });

    // Regression lock: a field the registry no longer accepts must not ride
    // along and make the server refuse the whole PUT. The block is REBUILT
    // from the three accepted fields, never spread from the stored value.
    it('drops a stale field left over in an older case config', async () => {
        agent = makeAgent('consultant', {
            knowledge: { scope: 'chart', answerKey: false, record: true, revealDiagnosis: true },
        });
        await openOverrides();
        save();
        await settled();
        expect(knowledgeOfPut()).toEqual({ scope: 'chart', answerKey: false, record: true });
        expect(knowledgeOfPut()).not.toHaveProperty('revealDiagnosis');
    });

    // The affordance that stops an educator building an incoherent agent: one
    // told nothing about the patient, and handed the full list of everything
    // that was ordered and given. The two stay independent in the data — the
    // editor just does not let you walk into it by accident.
    it('turns the record off when the scope is set to "knows nothing"', async () => {
        await openOverrides();
        expect(screen.getByLabelText(/Tell it what the learner has done/i).checked).toBe(true);
        fireEvent.change(screen.getByDisplayValue(/The whole chart/i), { target: { value: 'none' } });
        expect(screen.getByLabelText(/Tell it what the learner has done/i).checked).toBe(false);
        save();
        await settled();
        expect(knowledgeOfPut()).toEqual({ scope: 'none', answerKey: false, record: false });
    });

    it('disables the answer key below the chart scope, where nothing carries it', async () => {
        await openOverrides();
        expect(screen.getByLabelText(/Also give it the expected diagnosis/i).disabled).toBe(false);
        fireEvent.change(screen.getByDisplayValue(/The whole chart/i), { target: { value: 'history' } });
        expect(screen.getByLabelText(/Also give it the expected diagnosis/i).disabled).toBe(true);
    });
});

describe('which agents get the block', () => {
    it('does not render for an on-call specialist, whose own gate is the control', async () => {
        // A specialist is `none` by definition — the server drops the client
        // situation and builds a findings-only brief — so a scope dropdown
        // here would be a setting that changes nothing.
        agent = makeAgent('pathologist', { disclosure: { findings: 'after_effort', minStudentTurns: 3, requireRoomActivity: true } });
        await openOverrides({ expectKnowledge: false });
        await screen.findByText(/On-call specialist/i);
        expect(screen.queryByText(/What this agent knows about the case/i)).toBeNull();
    });

    it('does not render for the patient, whose prompt is built elsewhere', async () => {
        agent = makeAgent('patient');
        await openOverrides({ expectKnowledge: false });
        expect(screen.queryByText(/What this agent knows about the case/i)).toBeNull();
    });
});

// Regression lock: the save ACCUMULATES.
//
// The discussant, specialist and knowledge blocks each used to assign
// `updates.config_override` outright. That was safe only while no agent could
// match two of them. The knowledge block spans nearly every type, so a
// discussant now matches two — and with plain assignment the second would have
// silently dropped the first, taking unlock_trigger and show_encounter_record
// with it on every save.
describe('an agent that matches two blocks', () => {
    it('keeps an edit made in the discussant block AND the knowledge block', async () => {
        // Both values are CHANGED from what is stored. Asserting only the
        // stored values would pass under plain assignment too, since the
        // shared `base` already carries them — the edits are what a dropped
        // assignment actually loses.
        agent = makeAgent('discussant', {
            unlock_trigger: 'after_case_ended',
            show_encounter_record: false,
            knowledge: { scope: 'summary', answerKey: false, record: true },
        });
        await openOverrides();
        fireEvent.click(screen.getByLabelText(/Show the encounter record/i));
        fireEvent.change(screen.getByDisplayValue(/A brief summary/i), { target: { value: 'chart' } });
        save();
        await settled();
        const override = wire.lastAgentPut.config_override;
        expect(override.knowledge).toEqual({ scope: 'chart', answerKey: false, record: true });
        expect(override.show_encounter_record).toBe(true);
        expect(override.unlock_trigger).toBe('after_case_ended');
        expect(override.voice).toEqual({ case_voice: 'bf_emma' });
    });
});
