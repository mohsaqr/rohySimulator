import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import Exam3DScreen from './Exam3DScreen.jsx';
import { VoiceProvider } from '../../contexts/VoiceContext';
import EventLogger from '../../services/eventLogger';

const controller = {
    update: vi.fn(),
    addTimelineEvent: vi.fn(),
    dispose: vi.fn(),
    emphasizeRegion: vi.fn(),
    focusRegion: vi.fn(),
    markRegion: vi.fn(),
    react: vi.fn(),
    focusPreset: vi.fn(),
    say: vi.fn(),
    setNavSide: vi.fn(),
    setVisemes: vi.fn(),
    ecg_canvas: null,
};

vi.mock('rohy-3d-patient-room', () => ({
    mountPatientRoom: vi.fn(() => controller),
}));

const stopEcgMirror = vi.fn();
vi.mock('./ecgMirror.js', () => ({
    startEcgMirror: vi.fn(() => stopEcgMirror),
}));

vi.mock('./ManikinOverlay.jsx', () => ({
    default: () => <div data-testid="manikin-overlay" />,
}));

const examined = vi.fn();
const elicited = vi.fn();
vi.mock('../../services/PatientRecord', () => ({
    usePatientRecord: () => ({ examined, elicited }),
}));

// The voice itself is Rohy's service; the room only asks it to speak and to
// listen. STT reports as supported so the microphone renders.
const speak = vi.fn();
const startListening = vi.fn();
const stopListening = vi.fn();
vi.mock('../../services/voiceService', () => ({
    VoiceService: {
        speak: (...args) => speak(...args),
        cancelSpeech: vi.fn(),
        beginSpeechSession: vi.fn(() => ({
            enqueue: vi.fn(), flush: vi.fn(), cancel: vi.fn(),
        })),
        isSttSupported: () => true,
        startListening: (...args) => startListening(...args),
        stopListening: (...args) => stopListening(...args),
    },
}));
// The room asks the patient through the shared session thread; the turn
// itself has its own contract tests in useRoomConversation.test.jsx. The
// captured onReply lets a test deliver an answer the way the real hook does.
const ask = vi.fn();
let deliverReply = null;
vi.mock('./useRoomConversation.js', () => ({
    default: ({ onReply }) => {
        deliverReply = onReply;
        return { ask, thinking: false, error: null, ready: true };
    },
}));

// The session's Patient persona. A male-coded default template, so the room
// must resolve a male voice rather than the platform's female language
// default — the bug this mock exists to catch.
vi.mock('../../services/AgentService', () => ({
    AgentService: {
        getSessionAgents: () => Promise.resolve([]),
        getTemplates: () => Promise.resolve([{
            id: 4,
            agent_type: 'patient',
            is_default: 1,
            config: JSON.stringify({ voice: { gender: 'male', case_voice: 'am_michael' } }),
        }]),
    },
}));

const apiPost = vi.fn(() => Promise.resolve({}));
vi.mock('../../services/apiClient.js', () => ({
    apiFetch: () => Promise.resolve({
        voice_mode_enabled: true,
        tts_default_voice_en: 'am_adam',
        providers: [{ id: 'kokoro', usable: true }],
    }),
    apiPost: (...args) => apiPost(...args),
}));

const { mountPatientRoom } = await import('rohy-3d-patient-room');
const { startEcgMirror } = await import('./ecgMirror.js');

const renderRoom = (props = {}) => render(
    <VoiceProvider>
        <Exam3DScreen {...props} />
    </VoiceProvider>,
);

const ACTIVE_CASE = {
    id: 'case-3d',
    name: 'Breathless in Triage',
    patient_name: 'Daniel Moreau',
    patient_gender: 'Male',
    patient_age: 54,
    chief_complaint: 'Increasing shortness of breath',
    config: {
        avatar_id: 'avatarsdk.glb',
        physical_exam: {
            chestAnterior: {
                auscultation: {
                    finding: 'Widespread expiratory wheeze.',
                    abnormal: true,
                    heartAudio: '/uploads/wheeze.mp3',
                },
            },
        },
    },
};

describe('Exam3DScreen', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        controller.update.mockClear();
        controller.dispose.mockClear();
        mountPatientRoom.mockClear();
        startEcgMirror.mockClear();
        stopEcgMirror.mockClear();
        // AuscultationPanel auto-plays its first point on mount; jsdom has
        // no media playback.
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        EventLogger.setCurrentVitals({ hr: 104, spo2: 91, rr: 26, bpSys: 150, bpDia: 88, temp: 37.4 });
    });

    afterEach(() => {
        vi.useRealTimers();
        EventLogger.setCurrentVitals(null);
    });

    it('mounts the room in bound mode with the mapped case patient and avatar', () => {
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        expect(mountPatientRoom).toHaveBeenCalledTimes(1);
        const [host, options] = mountPatientRoom.mock.calls[0];
        expect(host).toBeInstanceOf(HTMLElement);
        expect(options.mode).toBe('bound');
        expect(options.waveform).toBe('host');
        expect(options.avatar_url).toBe('/avatars/heads/avatarsdk.glb');
        expect(startEcgMirror).toHaveBeenCalledWith(controller.ecg_canvas, expect.any(Function));
        expect(options.patient).toMatchObject({ name: 'Daniel Moreau', pronouns: 'he/him' });
        expect(options.records).toBeUndefined();
        expect(options.treatments).toBeUndefined();
    });

    it('attaches the real exam model to every supine region for the exam wheel', () => {
        const { queryByTestId } = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7, onOpenDrawer: () => {} });
        const { body_regions, on_event, on_exam } = mountPatientRoom.mock.calls[0][1];
        expect(body_regions.length).toBeGreaterThan(10);
        expect(typeof on_exam).toBe('function');
        const chest = body_regions.find((region) => region.id === 'chestAnterior');
        expect(chest.exams.map((exam) => exam.id)).toEqual(
            ['inspection', 'palpation', 'percussion', 'auscultation'],
        );
        const abdomen = body_regions.find((region) => region.id === 'abdomen');
        const special = abdomen.exams.find((exam) => exam.id === 'special');
        expect(special.tests.length).toBe(5);
        // A region click stays inside the room (the exam wheel opens there);
        // the React layer only logs it and must NOT open the panel.
        const { act } = require('react');
        act(() => {
            on_event({ type: 'selection', kind: 'region', id: 'chestAnterior', label: 'Anterior chest' });
        });
        expect(queryByTestId('exam-panel')).toBeNull();
    });

    it('lets Rohy present findings so auscultation keeps its real panel', () => {
        const { act } = require('react');
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        const { findings, on_exam } = mountPatientRoom.mock.calls[0][1];
        // The room must not draw its own finding card — Rohy's
        // FindingDisplay/AuscultationPanel is the presentation surface.
        expect(findings).toBe('host');

        act(() => {
            on_exam({ region_id: 'chestAnterior', exam_id: 'auscultation', test: null });
        });
        // AuscultationPanel's clickable points and audio element are back.
        expect(view.getByText(/Widespread expiratory wheeze\./)).toBeDefined();
        expect(view.container.querySelectorAll('button[title]').length).toBeGreaterThanOrEqual(5);
        expect(view.container.querySelector('audio')).not.toBeNull();
    });

    it('performs wheel exams through the parity performer', () => {
        const physicalExam = vi.spyOn(EventLogger, 'physicalExamPerformed').mockImplementation(() => {});
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        const { on_exam, on_event } = mountPatientRoom.mock.calls[0][1];

        const result = on_exam({ region_id: 'chestAnterior', exam_id: 'auscultation', test: null });
        expect(result.finding).toBe('Widespread expiratory wheeze.');
        expect(result.abnormal).toBe(true);
        expect(physicalExam).toHaveBeenCalledWith(
            'chestAnterior',
            'auscultation',
            'Widespread expiratory wheeze.',
            expect.objectContaining({ gender: 'Male', abnormal: true, room3d: true }),
        );
        expect(examined).toHaveBeenCalledWith('chestAnterior', 'auscultation', 'Widespread expiratory wheeze.');
        expect(elicited).toHaveBeenCalledWith('exam', 'Widespread expiratory wheeze.', true, {
            category: 'chestAnterior',
            significance: 'Abnormal finding',
        });

        // A named special test performs 'special' with the test name logged.
        const special = on_exam({ region_id: 'abdomen', exam_id: 'special', test: "Murphy's sign" });
        expect(special.finding.startsWith("Murphy's sign: ")).toBe(true);
        expect(special.abnormal).toBe(false);

        // The abnormal exam makes the patient answer out loud.
        on_event({ type: 'exam', region_id: 'chestAnterior', abnormal: true });
        expect(controller.say).toHaveBeenCalledWith('Ah— that is sore when you press there.');
        physicalExam.mockRestore();
    });

    it("opens Rohy's examination manikin from the Body map pill", () => {
        const { queryByTestId, getByTestId, getByRole } = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7, onOpenDrawer: () => {} });
        expect(queryByTestId('manikin-overlay')).toBeNull();
        const { fireEvent } = require('@testing-library/react');
        fireEvent.click(getByRole('button', { name: /body map/i }));
        expect(getByTestId('manikin-overlay')).toBeDefined();
    });

    it('routes 3D object clicks to Rohy own OrdersDrawer tabs', () => {
        const onOpenDrawer = vi.fn();
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7, onOpenDrawer });
        const { on_event } = mountPatientRoom.mock.calls[0][1];
        on_event({ type: 'selection', id: 'chart', label: 'Open clinical chart' });
        expect(onOpenDrawer).toHaveBeenLastCalledWith('records');
        on_event({ type: 'selection', id: 'oxygen', label: 'Controlled oxygen' });
        expect(onOpenDrawer).toHaveBeenLastCalledWith('treatments');
        on_event({ type: 'selection', id: 'iv', label: 'IV equipment' });
        expect(onOpenDrawer).toHaveBeenLastCalledWith('treatments');
        on_event({ type: 'selection', id: 'patient', label: 'Assess' });
        expect(onOpenDrawer).toHaveBeenCalledTimes(3);
    });

    it('feeds EventLogger.currentVitals into the room once per second', () => {
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        expect(controller.update).toHaveBeenCalledWith(
            expect.objectContaining({ heart_rate: 104, oxygen_saturation: 91, systolic: 150 }),
            null,
            0,
            { rhythm: null },
        );
        EventLogger.setCurrentVitals({ hr: 96, spo2: 95, rr: 18, bpSys: 132, bpDia: 80, temp: 37.0 });
        vi.advanceTimersByTime(1000);
        expect(controller.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ heart_rate: 96, oxygen_saturation: 95 }),
            null,
            1,
            { rhythm: null },
        );
    });

    it('passes a named rhythm through to the monitor label', () => {
        EventLogger.setCurrentVitals({ hr: 132, spo2: 93, rr: 22, bpSys: 118, bpDia: 74, temp: 37.2, rhythm: 'AFib' });
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        expect(controller.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ heart_rate: 132 }),
            null,
            0,
            { rhythm: 'Atrial Fibrillation' },
        );
    });

    it('skips updates while the feed is non-numeric and disposes on unmount', () => {
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 }).unmount();
        expect(controller.dispose).toHaveBeenCalledTimes(1);
        expect(stopEcgMirror).toHaveBeenCalledTimes(1);

        EventLogger.setCurrentVitals({ hr: 0, spo2: '?', rr: 4, bpSys: '?', bpDia: '?', temp: 36.0 });
        controller.update.mockClear();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        vi.advanceTimersByTime(2000);
        expect(controller.update).not.toHaveBeenCalled();
        view.unmount();
    });

    it('speaks an abnormal reaction in the case voice and subtitles it', async () => {
        const { act } = require('react');
        speak.mockClear();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        // Voice settings arrive from the platform endpoint.
        await act(async () => { await Promise.resolve(); });

        const { on_event } = mountPatientRoom.mock.calls[0][1];
        act(() => {
            on_event({ type: 'exam', region_id: 'chestAnterior', abnormal: true });
        });

        // Spoken through Rohy's service with a resolved voice...
        expect(speak).toHaveBeenCalledTimes(1);
        const spoken = speak.mock.calls[0][0];
        expect(spoken.text).toBe('Ah— that is sore when you press there.');
        // The session's Patient persona, not the platform's language default
        // (am_adam here). This assertion used to read the default, which was
        // the bug: with no persona tier, every unconfigured case spoke in the
        // platform default voice regardless of who the patient was.
        expect(spoken.voice).toBe('am_michael');
        // ...and the room still shows the line itself.
        expect(controller.say).toHaveBeenCalledWith('Ah— that is sore when you press there.');

        // The caption waits for the audio's head start, then appears.
        act(() => { spoken.onStart(); });
        expect(view.container.textContent).not.toContain('that is sore when you press there');
        act(() => { vi.advanceTimersByTime(4000); });
        expect(view.container.textContent).toContain('that is sore when you press there');

        // It leaves when the patient stops talking.
        act(() => { spoken.onEnd(); });
        expect(view.container.textContent).not.toContain('that is sore when you press there');
    });

    it('mutes the patient from the room control', async () => {
        const { act, fireEvent } = { ...require('react'), ...require('@testing-library/react') };
        speak.mockClear();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        await act(async () => { await Promise.resolve(); });

        fireEvent.click(view.getByLabelText("Mute the patient's voice"));
        const { on_event } = mountPatientRoom.mock.calls[0][1];
        act(() => {
            on_event({ type: 'exam', region_id: 'abdomen', abnormal: true });
        });
        expect(speak).not.toHaveBeenCalled();
        // The line is still shown in the room — muting silences, not hides.
        expect(controller.say).toHaveBeenCalledWith('That really hurts when you push on my belly.');
    });

    it('puts Rohy destinations on the navigation wheel and opens them', () => {
        const { act } = require('react');
        const onOpenDrawer = vi.fn();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7, onOpenDrawer });
        const { nav_actions, on_event } = mountPatientRoom.mock.calls[0][1];
        expect(nav_actions.map((action) => action.id)).toEqual(['examine', 'records', 'bodymap']);

        // 'examine' is the room's own business; these two are Rohy's.
        act(() => { on_event({ type: 'nav', id: 'records' }); });
        expect(onOpenDrawer).toHaveBeenCalledWith('records');

        expect(view.queryByTestId('manikin-overlay')).toBeNull();
        act(() => { on_event({ type: 'nav', id: 'bodymap' }); });
        expect(view.getByTestId('manikin-overlay')).toBeDefined();
    });

    it('hands the left side to the finding chart and takes it back', () => {
        const { act } = require('react');
        controller.setNavSide.mockClear();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        // Nothing examined yet: navigation keeps its usual side.
        expect(controller.setNavSide).toHaveBeenLastCalledWith('left');

        const { on_exam } = mountPatientRoom.mock.calls[0][1];
        act(() => { on_exam({ region_id: 'chestAnterior', exam_id: 'auscultation', test: null }); });
        // The chart docks left, so the wheel steps across rather than
        // sitting underneath it.
        expect(controller.setNavSide).toHaveBeenLastCalledWith('right');

        const { fireEvent } = require('@testing-library/react');
        fireEvent.click(view.getByLabelText('Close finding'));
        expect(controller.setNavSide).toHaveBeenLastCalledWith('left');
    });

    it('offers a microphone, and opens it in the session language', () => {
        const { fireEvent } = require('@testing-library/react');
        startListening.mockClear();
        const view = renderRoom({
            activeCase: { ...ACTIVE_CASE, config: { ...ACTIVE_CASE.config, language: 'it' } },
            sessionId: 7,
        });
        fireEvent.click(view.getByLabelText(/listening/i));
        expect(startListening).toHaveBeenCalledTimes(1);
        // A learner in an Italian session speaks Italian into the room.
        expect(startListening.mock.calls[0][0].lang).toBe('it-IT');
    });

    it('shows the learner their own words, then hands the caption back', () => {
        const { act } = require('react');
        const { fireEvent } = require('@testing-library/react');
        startListening.mockClear();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        fireEvent.click(view.getByLabelText(/listening/i));

        const { onResult, onEnd } = startListening.mock.calls[0][0];
        act(() => { onResult({ final: '', interim: 'where does it hurt', isFinal: false }); });
        expect(view.getByText('where does it hurt')).toBeTruthy();
        expect(view.getByText('YOU')).toBeTruthy();

        // Ending the turn sends it to the patient and clears the learner's
        // caption — the patient's answer takes the band from here.
        ask.mockClear();
        act(() => { onEnd({ final: 'where does it hurt' }); });
        expect(ask).toHaveBeenCalledWith('where does it hurt');
        expect(view.queryByText('where does it hurt')).toBeNull();
    });

    it('takes the space bar for its own microphone, not the hidden chat\'s', () => {
        const { fireEvent } = require('@testing-library/react');
        startListening.mockClear();
        // A window-level listener stands in for ChatInterface, which is
        // still mounted (hidden and inert) beneath this room with its own
        // space-bar voice turn. Exactly one microphone may open.
        const chatHeard = vi.fn();
        window.addEventListener('keydown', chatHeard);
        try {
            renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
            fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
            expect(startListening).toHaveBeenCalledTimes(1);
            expect(chatHeard).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', chatHeard);
        }
    });

    it('leaves the space bar alone while the learner is typing', () => {
        const { fireEvent } = require('@testing-library/react');
        startListening.mockClear();
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        const field = document.createElement('input');
        document.body.appendChild(field);
        try {
            fireEvent.keyDown(field, { code: 'Space', key: ' ' });
            expect(startListening).not.toHaveBeenCalled();
        } finally {
            field.remove();
        }
    });

    // Regression, 2026-09-01. The room captioned only what the voice was
    // speaking, so with voice mode off (no `voice_mode_enabled` row) the
    // patient answered — the reply was in the interactions table — and the
    // learner saw and heard nothing at all.
    it('shows an answer that nothing is going to speak', () => {
        const { act } = require('react');
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        // A reply to a question typed in the chat room, with the chat's
        // voice mode off: nobody will voice it, so it goes straight up.
        act(() => { deliverReply('It started this morning.', { source: 'typed' }); });
        expect(view.getByText('It started this morning.')).toBeTruthy();
    });

    it('waits for the audio head start when the answer IS being spoken', async () => {
        const { act } = require('react');
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        // Voice settings arrive, so the room's voice is available.
        await act(async () => { await Promise.resolve(); });
        // A reply to a question asked HERE is voiced: it stays off screen
        // until the voice is actually playing, so the caption never runs
        // ahead of the patient.
        act(() => { deliverReply('It started this morning.', { source: 'room3d' }); });
        expect(view.queryByText('It started this morning.')).toBeNull();
    });

    it('shows a reply the chat room could not voice, instead of waiting for it', async () => {
        const { act } = require('react');
        // The room asked aloud, but the host reports the reply is NOT being
        // voiced (no voice resolved, or TTS failed) — the line must go up.
        const view = renderRoom({
            activeCase: ACTIVE_CASE, sessionId: 7,
            conversation: { messages: [], loading: false, voiced: false, sessionId: 7, send: vi.fn() },
        });
        await act(async () => { await Promise.resolve(); });
        act(() => { deliverReply('It has stayed severe.', { source: 'room3d' }); });
        expect(view.getByText('It has stayed severe.')).toBeTruthy();
    });

    it('persists a wheel exam to the session, like the 2D room does', async () => {
        const { act } = require('react');
        apiPost.mockClear();
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        const { on_exam } = mountPatientRoom.mock.calls[0][1];
        await act(async () => { await on_exam({ region_id: 'chestAnterior', exam_id: 'auscultation' }); });
        expect(apiPost).toHaveBeenCalledWith('/sessions/7/exam-findings', expect.objectContaining({
            body_region: 'chestAnterior', exam_type: 'auscultation', is_abnormal: true,
        }));
    });

    it('drives the room avatar\'s mouth from the same viseme stream as Rohy\'s', async () => {
        const { act } = require('react');
        controller.setVisemes.mockClear();
        speak.mockClear();
        renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        // Voice settings arrive from the platform endpoint.
        await act(async () => { await Promise.resolve(); });
        const { on_event } = mountPatientRoom.mock.calls[0][1];

        // An abnormal finding makes the patient say something aloud; the
        // voice's mouth shapes must reach the 3D face, not only Rohy's.
        act(() => { on_event({ type: 'exam', region_id: 'chestAnterior', abnormal: true }); });
        const { onVisemes } = speak.mock.calls.at(-1)[0];
        act(() => { onVisemes({ viseme_aa: 0.8 }); });
        expect(controller.setVisemes).toHaveBeenCalledWith({ viseme_aa: 0.8 });
    });

    it('falls back to showing a line whose voice failed', async () => {
        const { act } = require('react');
        speak.mockClear();
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: 7 });
        await act(async () => { await Promise.resolve(); });
        const { on_event } = mountPatientRoom.mock.calls[0][1];
        act(() => { on_event({ type: 'exam', region_id: 'chestAnterior', abnormal: true }); });

        // The line was reported as spoken, so the caption is waiting on audio.
        expect(view.container.textContent).not.toContain('that is sore when you press there');
        // TTS then fails. The words must not go down with it.
        act(() => { speak.mock.calls.at(-1)[0].onError(new Error('model failed to load')); });
        expect(view.container.textContent).toContain('that is sore when you press there');
    });

    // Regression, 2026-09-01: the room resolved the voice WITHOUT the persona
    // tier, so any case with no explicit voice fell through to the platform's
    // per-language default — af_bella — and a male patient answered in a
    // woman's voice while the chat room, which passes the tier, was correct.
    it('speaks in the persona template\'s voice, not the platform default', async () => {
        const { act } = require('react');
        speak.mockClear();
        renderRoom({
            activeCase: { ...ACTIVE_CASE, config: { ...ACTIVE_CASE.config, demographics: { gender: 'Male' } } },
            sessionId: 7,
        });
        // Voice settings and the session's patient template both arrive.
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

        const { on_event } = mountPatientRoom.mock.calls[0][1];
        act(() => { on_event({ type: 'exam', region_id: 'chestAnterior', abnormal: true }); });
        expect(speak.mock.calls.at(-1)[0].voice).toBe('am_michael');
    });

    it('has no microphone before a session exists', () => {
        const view = renderRoom({ activeCase: ACTIVE_CASE, sessionId: null });
        expect(view.queryByLabelText(/listening/i)).toBeNull();
    });
});
