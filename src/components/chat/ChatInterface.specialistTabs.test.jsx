// Specialists (pathologist, cardiologist, radiologist) live in the on-call
// phone (src/components/oncall). ChatInterface must not also give them a
// team-agent tab. Setup mirrors ChatInterface.errorAndTabs.test.jsx.

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ChatInterface from './ChatInterface.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import { ttsHandlers } from '../../../tests/utils/mockTtsServer.js';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

const platformVoice = { voice_mode_enabled: false, tts_pitch: 1, tts_rate: 1 };

const caseFixture = {
    id: 42,
    name: 'Chest pain',
    system_prompt: 'You are the patient.',
    config: {
        patient_name: 'Alice Original',
        demographics: { age: 35, gender: 'male' },
    },
};

// A nurse who is simply IN the room: the paging lifecycle never moved her off
// 'absent', but availability_type says she is present the whole case.
const nurse = {
    id: 11,
    agent_template_id: 'tpl-nurse',
    agent_type: 'nurse',
    name: 'Nancy Alvarez',
    role_title: 'Floor Nurse',
    status: 'absent',
    availability_type: 'present',
    available_from_minute: 0,
    depart_at_minute: null,
    enabled: 1,
    config: JSON.stringify({}),
};

// An on-call specialist: reached through the on-call phone, never a tab.
const pathologist = {
    ...nurse,
    id: 12,
    case_agent_id: 12,
    agent_template_id: 'tpl-path',
    agent_type: 'pathologist',
    name: 'Dr. Ana Moreno',
    role_title: 'Consultant pathologist',
    availability_type: 'on-call',
};

let llmStatus = 200;

function defaultHandlers() {
    llmStatus = 200;
    return [
        ...ttsHandlers(),
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: { id: 1, username: 'tester', role: 'student' } })),
        http.get('*/api/platform-settings/voice', () => HttpResponse.json(platformVoice)),
        http.get('*/api/platform-settings/chat', () =>
            HttpResponse.json({ doctorName: 'Dr. Test', doctorAvatar: '' })),
        http.get('*/api/platform-settings/avatars', () => HttpResponse.json({})),
        http.get('*/avatars/heads/manifest.json', () => HttpResponse.json({})),
        http.get('*/api/sessions/:sid', ({ params }) => HttpResponse.json({
            session: {
                id: Number(params.sid),
                case_snapshot: JSON.stringify(caseFixture),
            },
        })),
        http.get('*/api/sessions/:sid/agents', () => HttpResponse.json({ agents: [nurse, pathologist] })),
        http.get('*/api/sessions/:sid/agents/:type/conversation', () =>
            HttpResponse.json({ messages: [] })),
        http.get('*/api/sessions/:sid/team-communications', () => HttpResponse.json({ log: [] })),
        http.get('*/api/agents/templates', () => HttpResponse.json({ templates: [] })),
        http.get('*/api/interactions/:sid', () => HttpResponse.json({ interactions: [] })),
        http.post('*/api/proxy/llm', () => {
            if (llmStatus !== 200) {
                return HttpResponse.json({ error: 'upstream exploded' }, { status: llmStatus });
            }
            return new HttpResponse(
                'data: {"delta":"I have chest pain."}\n\ndata: [DONE]\n\n',
                { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
            );
        }),
        http.post('*/api/interactions', () => HttpResponse.json({ ok: true })),
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({ ok: true })),
    ];
}

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
    window.localStorage.setItem('token', 'test-token');
});
afterEach(() => {
    server.resetHandlers(...defaultHandlers());
    window.localStorage.clear();
    window.sessionStorage.clear();
});
afterAll(() => server.close());

function mount() {
    return renderWithProviders(
        <ChatInterface
            activeCase={caseFixture}
            onSessionStart={() => {}}
            restoredSessionId={999}
            sessionStartTime={Date.now()}
            currentVitals={null}
        />,
        { withPatientRecord: false }
    );
}

describe('ChatInterface — no tab for on-call specialists', () => {
    it('renders the nurse tab but no tab for the pathologist', async () => {
        mount();
        await screen.findByRole('button', { name: /nancy/i });
        expect(screen.queryByRole('button', { name: /ana moreno/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Dr. Ana Moreno')).not.toBeInTheDocument();
    });
});
