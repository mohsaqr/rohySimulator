// Regression locks for three chat-room fixes from the 2026-08-30 UI review.
// Sibling of ChatInterface.test.jsx and ChatInterface.behavior.test.jsx —
// it must not touch either.
//
//   #6c  llmService now REJECTS on a failed LLM call instead of resolving
//        with the string "Error: …". The patient chat must keep surfacing
//        the failure honestly (visible text, not a blank bubble, not a
//        stuck spinner) now that it catches instead of sniffing a prefix.
//   #17  the agent tab badge derives from availability_type, so a nurse who
//        is in the room reads "Here" rather than "Away".
//   #35d the selected agent tab survives leaving the room and coming back
//        (ChatInterface unmounts on every room switch).

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
        http.get('*/api/sessions/:sid/agents', () => HttpResponse.json({ agents: [nurse] })),
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

describe('ChatInterface — a failed patient reply is still visible', () => {
    // Regression lock: a 500 from the proxy reaches the learner as text in the
    // bubble. The service now throws instead of resolving with "Error: …", so
    // the component has to catch it — a missing catch would leave a blank
    // bubble and a permanently disabled composer.
    it('renders the failure in the transcript and re-enables the composer', async () => {
        mount();
        const input = await screen.findByPlaceholderText(/message alice original/i);
        llmStatus = 500;

        fireEvent.change(input, { target: { value: 'How are you?' } });
        fireEvent.submit(input.closest('form'));

        await waitFor(() => {
            expect(screen.getByText(/upstream exploded/i)).toBeInTheDocument();
        }, { timeout: 5000 });
        // The learner's own message is still there, and the composer works again.
        expect(screen.getByText('How are you?')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByPlaceholderText(/message alice original/i)).not.toBeDisabled();
        });
    });

    it('still renders a successful reply (the happy path is untouched)', async () => {
        mount();
        const input = await screen.findByPlaceholderText(/message alice original/i);
        fireEvent.change(input, { target: { value: 'Hello?' } });
        fireEvent.submit(input.closest('form'));

        await waitFor(() => {
            expect(screen.getByText('I have chest pain.')).toBeInTheDocument();
        }, { timeout: 5000 });
    });
});

describe('ChatInterface — agent tab badge', () => {
    // Regression lock: badge from availability_type, not the raw paging status.
    it('badges a present-by-configuration nurse as "Here", never "Away"', async () => {
        mount();
        const nurseTab = await screen.findByRole('button', { name: /nancy/i });
        await waitFor(() => {
            expect(nurseTab).toHaveTextContent('Here');
        });
        expect(nurseTab).not.toHaveTextContent('Away');
    });
});

describe('ChatInterface — the open tab survives a room round-trip', () => {
    // Regression lock: unmounting (leaving for the lab) and remounting
    // (coming back) keeps the learner on the agent they were talking to.
    it('restores the agent tab after an unmount/remount cycle', async () => {
        const first = mount();
        const nurseTab = await screen.findByRole('button', { name: /nancy/i });
        fireEvent.click(nurseTab);
        await screen.findByText(/chat with nancy/i);

        first.unmount();

        mount();
        await waitFor(() => {
            expect(screen.getByText(/chat with nancy/i)).toBeInTheDocument();
        }, { timeout: 5000 });
    });

    it('falls back to the patient tab when the remembered agent is gone', async () => {
        const first = mount();
        const nurseTab = await screen.findByRole('button', { name: /nancy/i });
        fireEvent.click(nurseTab);
        await screen.findByText(/chat with nancy/i);
        first.unmount();

        server.use(http.get('*/api/sessions/:sid/agents', () => HttpResponse.json({ agents: [] })));
        mount();
        await waitFor(() => {
            expect(screen.getByPlaceholderText(/message alice original/i)).toBeInTheDocument();
        }, { timeout: 5000 });
    });
});
