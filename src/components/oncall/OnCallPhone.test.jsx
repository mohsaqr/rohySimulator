// Contract for the on-call phone (useOnCall + OnCallButton + OnCallPhone, the
// way App mounts them).
//
//   - contacts list the case's specialists only (never the nurse/patient)
//   - Message pages an on-call specialist first, loads the thread, and a sent
//     text posts channel 'chat' and names the case agent to /proxy/llm
//   - a call without speech recognition offers typing; a call turn posts
//     channel 'call' with a call id; End call returns to the chat thread

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { useRef } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import OnCallButton from './OnCallButton';
import OnCallPhone from './OnCallPhone';
import { useOnCall } from './useOnCall';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

let sttSupported = false;
const voice = {
    startListening: vi.fn(),
    stopListening: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
};
vi.mock('../../services/voiceService', () => ({
    VoiceService: {
        isSttSupported: () => sttSupported,
        startListening: (...a) => voice.startListening(...a),
        stopListening: (...a) => voice.stopListening(...a),
        speak: (...a) => voice.speak(...a),
        cancelSpeech: (...a) => voice.cancelSpeech(...a),
    },
}));

const SESSION = 77;
const caseFixture = { id: 3, name: 'Haemoptysis', config: { patient_name: 'Alex' } };

function agentsFixture() {
    return [
        { case_agent_id: 1, agent_type: 'nurse', name: 'Nurse Sarah', role_title: 'Ward nurse', enabled: true, availability_type: 'present', status: 'absent', config: {} },
        { case_agent_id: 2, agent_type: 'patient', name: 'Default Patient', enabled: true, availability_type: 'present', status: 'absent', config: {} },
        { case_agent_id: 31, agent_type: 'pathologist', name: 'Dr. Ana Moreno', role_title: 'Consultant pathologist', enabled: true, availability_type: 'on-call', status: 'absent', avatar_url: 'rb_medical_female_01.glb', config: {} },
        { case_agent_id: 32, agent_type: 'radiologist', name: 'Dr. Jonas Berg', role_title: 'Consultant radiologist', enabled: true, availability_type: 'on-call', status: 'present', config: {} },
    ];
}

let requests = [];
let pageCalls = [];
let history = {};

async function record(request) {
    let body = null;
    try { body = await request.clone().json(); } catch { body = null; }
    const url = new URL(request.url);
    requests.push({ method: request.method, path: url.pathname, body });
    return body;
}

function handlers() {
    return [
        http.get('*/api/auth/verify', () => HttpResponse.json({ user: { id: 1, username: 'learner', role: 'student' } })),
        http.get('*/api/platform-settings/voice', () => HttpResponse.json({ voice_mode_enabled: false })),
        http.get('*/api/sessions/:sid/agents', () => HttpResponse.json({ agents: agentsFixture() })),
        http.post('*/api/sessions/:sid/agents/:type/page', ({ params }) => {
            pageCalls.push(params.type);
            return HttpResponse.json({ status: 'present', arrives_at: null });
        }),
        http.get('*/api/sessions/:sid/agents/:type/conversation', ({ params }) =>
            HttpResponse.json({ messages: history[params.type] || [] })),
        http.post('*/api/sessions/:sid/agents/:type/conversation', async ({ request }) => {
            await record(request);
            return HttpResponse.json({ id: requests.length, message: 'Message added' }, { status: 201 });
        }),
        http.post('*/api/proxy/llm', async ({ request }) => {
            await record(request);
            return HttpResponse.json({ choices: [{ message: { content: 'What do **you** think the margins show?' } }] });
        }),
        http.post('*/api/sessions/:sid/team-communications', () => HttpResponse.json({ logged: true })),
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({ ok: true })),
    ];
}

const server = setupServer(...handlers());
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
    window.localStorage.setItem('token', 'test-token');
    requests = [];
    pageCalls = [];
    history = {};
    sttSupported = false;
    Object.values(voice).forEach(fn => fn.mockClear());
});
afterEach(() => {
    server.resetHandlers(...handlers());
    window.localStorage.clear();
});
afterAll(() => server.close());

// The same composition App.jsx renders: the call icon plus the handset.
function Harness({ sessionId, activeCase, room = null }) {
    const onCall = useOnCall(sessionId);
    return (
        <>
            <OnCallButton
                sessionId={onCall.available ? sessionId : null}
                specialists={onCall.team.specialists}
                open={onCall.open}
                onClick={onCall.toggle}
            />
            {onCall.open && (
                <OnCallPhone
                    sessionId={sessionId}
                    activeCase={activeCase}
                    room={room}
                    team={onCall.team}
                    onClose={onCall.close}
                />
            )}
        </>
    );
}

function mount(room = null) {
    return renderWithProviders(<Harness sessionId={SESSION} activeCase={caseFixture} room={room} />);
}

async function openPhone() {
    const button = await screen.findByRole('button', { name: /on-call phone/i });
    fireEvent.click(button);
    return screen.findByRole('dialog', { name: /on-call phone/i });
}

const conversationPosts = (type) => requests.filter(r => r.method === 'POST' && r.path.endsWith(`/agents/${type}/conversation`));

describe('OnCallPhone — contacts', () => {
    it('lists the specialists only, with initials for 3D avatars', async () => {
        mount();
        const dialog = await openPhone();
        expect(within(dialog).getByTestId('oncall-contact-pathologist')).toHaveTextContent('Dr. Ana Moreno');
        expect(within(dialog).getByTestId('oncall-contact-pathologist')).toHaveTextContent('AM');
        expect(within(dialog).getByTestId('oncall-contact-radiologist')).toHaveTextContent('Available');
        expect(within(dialog).getByTestId('oncall-contact-pathologist')).toHaveTextContent('On call');
        expect(within(dialog).queryByText('Nurse Sarah')).not.toBeInTheDocument();
        expect(within(dialog).queryByText('Default Patient')).not.toBeInTheDocument();
    });

    it('Escape closes the phone', async () => {
        mount();
        const dialog = await openPhone();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});

describe('OnCallPhone — the room decides who answers', () => {
    it('opens straight in the thread of the specialist who owns the room, and pages them', async () => {
        history.radiologist = [{ role: 'assistant', content: 'Radiology, Jonas here.', channel: 'chat', call_id: null }];
        mount('radiology');
        const dialog = await openPhone();

        // Radiology belongs to the radiologist: no contact list step.
        expect(await within(dialog).findByText('Radiology, Jonas here.')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Message Dr. Jonas Berg')).toBeInTheDocument();
        expect(within(dialog).queryByText('Who do you need?')).not.toBeInTheDocument();

        // Back always reaches the whole team.
        fireEvent.click(within(dialog).getByRole('button', { name: 'Back to contacts' }));
        expect(await within(dialog).findByText('Who do you need?')).toBeInTheDocument();
    });

    it('opens on the contact list in a room no specialist owns', async () => {
        mount('lab');
        const dialog = await openPhone();
        expect(await within(dialog).findByText('Who do you need?')).toBeInTheDocument();
    });
});

describe('OnCallPhone — chat', () => {
    it('pages an on-call specialist, loads the thread, sends a chat turn and renders the reply', async () => {
        history.pathologist = [{ role: 'assistant', content: 'Pathology, Ana here.', channel: 'chat', call_id: null }];
        mount();
        const dialog = await openPhone();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Message Dr. Ana Moreno' }));

        expect(await within(dialog).findByText('Pathology, Ana here.')).toBeInTheDocument();
        await waitFor(() => expect(pageCalls).toEqual(['pathologist']));

        const composer = within(dialog).getByLabelText('Message Dr. Ana Moreno');
        await waitFor(() => expect(composer).not.toBeDisabled());
        fireEvent.change(composer, { target: { value: 'Is the resection margin involved?' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

        // Markdown is stripped: the reply renders as plain text.
        expect(await within(dialog).findByText('What do you think the margins show?')).toBeInTheDocument();

        const posts = conversationPosts('pathologist');
        expect(posts.map(r => [r.body.role, r.body.channel, r.body.call_id])).toEqual([
            ['user', 'chat', undefined],
            ['assistant', 'chat', undefined],
        ]);
        const llm = requests.find(r => r.path.endsWith('/api/proxy/llm'));
        expect(llm.body.agent_llm_config).toEqual({ case_agent_id: 31 });
        expect(llm.body.session_id).toBe(SESSION);
        expect(llm.body.messages).toEqual([
            { role: 'assistant', content: 'Pathology, Ana here.' },
            { role: 'user', content: 'Is the resection margin involved?' },
        ]);
    });

    it('does not page a specialist who is already present', async () => {
        mount();
        const dialog = await openPhone();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Message Dr. Jonas Berg' }));
        await within(dialog).findByText(/text dr\. jonas berg about this case/i);
        expect(pageCalls).toEqual([]);
    });
});

describe('OnCallPhone — call', () => {
    it('without speech recognition offers typing; a call turn posts channel "call" with a call id; End returns to chat', async () => {
        sttSupported = false;
        mount();
        const dialog = await openPhone();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Call Dr. Jonas Berg' }));

        expect(await within(dialog).findByText(/speech input is not available/i)).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: 'Start talking' })).not.toBeInTheDocument();

        const input = within(dialog).getByLabelText('What you say');
        fireEvent.change(input, { target: { value: 'Can you walk me through the CT?' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Say it' }));

        expect(await within(dialog).findByTestId('oncall-subtitle')).toHaveTextContent('What do you think the margins show?');

        const posts = conversationPosts('radiologist');
        expect(posts).toHaveLength(2);
        const callId = posts[0].body.call_id;
        expect(callId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(posts.map(r => [r.body.role, r.body.channel, r.body.call_id])).toEqual([
            ['user', 'call', callId],
            ['assistant', 'call', callId],
        ]);

        fireEvent.click(within(dialog).getByRole('button', { name: 'End call' }));
        expect(voice.cancelSpeech).toHaveBeenCalled();
        expect(voice.stopListening).toHaveBeenCalled();
        // Back on the chat screen, the call turns sit in the thread.
        const composer = await within(dialog).findByLabelText('Message Dr. Jonas Berg');
        expect(composer).toBeInTheDocument();
        expect(within(dialog).getByText('Can you walk me through the CT?')).toBeInTheDocument();
        expect(within(dialog).getAllByText('Call').length).toBeGreaterThanOrEqual(2);
    });

    it('with speech recognition, Talk then Done sends the transcript as a call turn', async () => {
        sttSupported = true;
        let listener = null;
        voice.startListening.mockImplementation((opts) => { listener = opts; });
        voice.stopListening.mockImplementation(() => { listener?.onEnd?.({ final: 'Is there a hilar node?' }); listener = null; });
        let voiceSettingsServed = false;
        server.use(http.get('*/api/platform-settings/voice', () => {
            voiceSettingsServed = true;
            return HttpResponse.json({ stt_language: 'en-US' });
        }));
        mount();
        const dialog = await openPhone();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Call Dr. Jonas Berg' }));

        const talk = await within(dialog).findByRole('button', { name: 'Start talking' });
        await waitFor(() => expect(talk).not.toBeDisabled());
        // The platform voice settings carry the STT locale for an English session.
        await waitFor(() => expect(voiceSettingsServed).toBe(true));
        await new Promise(r => setTimeout(r, 0));
        fireEvent.click(talk);
        expect(voice.startListening).toHaveBeenCalledTimes(1);
        expect(voice.startListening.mock.calls[0][0].lang).toBe('en-US');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Stop talking and send' }));
        await waitFor(() => expect(conversationPosts('radiologist')).toHaveLength(2));
        expect(conversationPosts('radiologist')[0].body).toMatchObject({ role: 'user', content: 'Is there a hilar node?', channel: 'call' });
    });
});

// The call button lives in each room's own header, so changing room while the
// handset is open replaces it. The handset must hand focus back to the button
// that is on screen when it closes, not the one it captured on opening.
function FocusHarness({ which, open }) {
    const ref = useRef(null);
    return (
        <>
            {which === 'a'
                ? <button key="a" ref={ref} type="button">room A phone</button>
                : <button key="b" ref={ref} type="button">room B phone</button>}
            {open && (
                <OnCallPhone
                    sessionId={SESSION}
                    activeCase={caseFixture}
                    team={{ specialists: [], loaded: true, now: Date.now(), page: vi.fn() }}
                    onClose={() => {}}
                    returnFocusRef={ref}
                />
            )}
        </>
    );
}

describe('OnCallPhone focus', () => {
    // Regression lock: focus fell to <body> after a room change, because the
    // handset returned it to the node captured at open — detached by then.
    it('returns focus to the button on screen at close, after a room change replaced it', async () => {
        const view = renderWithProviders(<FocusHarness which="a" open />);
        await screen.findByRole('dialog', { name: /on-call phone/i });
        view.rerender(<FocusHarness which="b" open />);
        view.rerender(<FocusHarness which="b" open={false} />);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'room B phone' }));
    });
});
