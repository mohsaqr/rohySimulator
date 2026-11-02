// Contract for VoiceControl — Rohy's one microphone control.
//
// It was written for the debrief screen; the 3D room now uses the SAME
// component so the two surfaces cannot drift into two mic implementations
// (and so the room inherits its seven translations for free). The first
// block below is CHARACTERIZATION: it pins the debrief behaviour exactly as
// it was before the room existed, so the additive props can never change it.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VoiceControl from './VoiceControl';
import { NotificationContextObject } from '../../notifications/NotificationContextObject';

// The recogniser itself is Rohy's service; this component only drives it.
const listeners = {};
const listens = [];
const startListening = vi.fn((opts) => { Object.assign(listeners, opts); });
const stopListening = vi.fn(() => { listeners.onEnd?.({ final: listeners._final ?? '' }); });
let supported = true;

vi.mock('../../services/voiceService', () => ({
    VoiceService: {
        isSttSupported: () => supported,
        startListening: (...args) => startListening(...args),
        stopListening: (...args) => stopListening(...args),
    },
}));

const mic = () => screen.getByRole('button');

beforeEach(() => {
    supported = true;
    startListening.mockReset();
    startListening.mockImplementation((opts) => { Object.assign(listeners, opts); });
    stopListening.mockClear();
    Object.keys(listeners).forEach((k) => delete listeners[k]);
});

describe('VoiceControl (characterization — debrief behaviour)', () => {
    it('opens the recogniser with the caller\'s language on the first tap', () => {
        render(<VoiceControl onSend={vi.fn()} sttLang="it-IT" />);
        fireEvent.click(mic());
        expect(startListening).toHaveBeenCalledTimes(1);
        expect(startListening.mock.calls[0][0].lang).toBe('it-IT');
    });

    it('sends the final transcript when the recogniser ends, and only then', () => {
        const onSend = vi.fn();
        render(<VoiceControl onSend={onSend} sttLang="en-US" />);
        fireEvent.click(mic());

        // Interim results must NOT send — a pause mid-sentence is not the end
        // of a turn.
        act(() => listeners.onResult({ final: '', interim: 'does it hurt', isFinal: false }));
        expect(onSend).not.toHaveBeenCalled();

        act(() => listeners.onEnd({ final: 'does it hurt when I press here' }));
        expect(onSend).toHaveBeenCalledWith('does it hurt when I press here');
    });

    it('mirrors listening + interim to the parent for the subtitle band', () => {
        const onListeningChange = vi.fn();
        render(<VoiceControl onSend={vi.fn()} sttLang="en-US" onListeningChange={onListeningChange} />);
        fireEvent.click(mic());
        act(() => listeners.onResult({ final: '', interim: 'where is the pain', isFinal: false }));
        expect(onListeningChange).toHaveBeenLastCalledWith(true, 'where is the pain');
    });

    it('is disabled while the other speaker talks, so we never record our own audio', () => {
        render(<VoiceControl onSend={vi.fn()} sttLang="en-US" speaking />);
        expect(mic()).toBeDisabled();
        fireEvent.click(mic());
        expect(startListening).not.toHaveBeenCalled();
    });

    it('stops an open mic when the other speaker starts', () => {
        const { rerender } = render(<VoiceControl onSend={vi.fn()} sttLang="en-US" />);
        fireEvent.click(mic());
        stopListening.mockClear();
        rerender(<VoiceControl onSend={vi.fn()} sttLang="en-US" speaking />);
        expect(stopListening).toHaveBeenCalled();
    });

    it('says so, rather than rendering a dead button, when the browser has no STT', () => {
        supported = false;
        render(<VoiceControl onSend={vi.fn()} sttLang="en-US" />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText(/isn't supported/i)).toBeTruthy();
    });
});

describe('VoiceControl (additive — the 3D room)', () => {
    it('barge-in: with onInterrupt, the mic stays live while the patient talks', () => {
        const onInterrupt = vi.fn();
        render(<VoiceControl onSend={vi.fn()} sttLang="en-US" speaking onInterrupt={onInterrupt} />);
        expect(mic()).not.toBeDisabled();

        fireEvent.click(mic());
        // The patient is silenced FIRST, then the mic opens — otherwise the
        // recogniser's first words are the patient's.
        expect(onInterrupt).toHaveBeenCalledTimes(1);
        expect(startListening).toHaveBeenCalledTimes(1);
        expect(onInterrupt.mock.invocationCallOrder[0])
            .toBeLessThan(startListening.mock.invocationCallOrder[0]);
    });

    it('barge-in does not leak into the debrief: no onInterrupt, no change', () => {
        render(<VoiceControl onSend={vi.fn()} sttLang="en-US" speaking />);
        expect(mic()).toBeDisabled();
    });

    it('the room variant carries the room\'s palette, not the debrief indigo', () => {
        const { container } = render(
            <VoiceControl onSend={vi.fn()} sttLang="en-US" variant="room" />
        );
        const cls = container.querySelector('button').className;
        expect(cls).toContain('teal');
        expect(cls).not.toContain('indigo');
    });

    it('lets a caller without a type button supply its own unsupported line', () => {
        supported = false;
        render(
            <VoiceControl
                onSend={vi.fn()}
                sttLang="en-US"
                unsupportedText="Speech recognition is not supported in this browser."
            />
        );
        // The debrief's own wording sends the learner to a button the 3D
        // room does not have.
        expect(screen.queryByText(/type button/i)).toBeNull();
        expect(screen.getByText(/not supported in this browser/i)).toBeTruthy();
    });

    it('exposes a start handle so a room key can talk without the button', () => {
        const ref = React.createRef();
        render(<VoiceControl ref={ref} onSend={vi.fn()} sttLang="en-US" />);
        act(() => ref.current.toggle());
        expect(startListening).toHaveBeenCalledTimes(1);
        act(() => ref.current.toggle());
        expect(stopListening).toHaveBeenCalled();
    });
});

// Hands-free on the debrief and the Bedside room: the same engine as the
// patient chat and the phone, under the learner's one Hands-free preference.
describe('VoiceControl (hands-free — the shared voice-conversation engine)', () => {
    const PAUSE_MS = 900;

    function HandsFreeOn({ children, setPrefs = vi.fn() }) {
        return (
            <NotificationContextObject.Provider value={{ prefs: { handsFreeConversation: true }, setPrefs }}>
                {children}
            </NotificationContextObject.Provider>
        );
    }

    beforeEach(() => {
        vi.useFakeTimers();
        startListening.mockImplementation((opts) => { listens.push(opts); Object.assign(listeners, opts); });
        listens.length = 0;
    });
    afterEach(() => { vi.useRealTimers(); });

    it('shows the Hands-free switch, which writes the one shared preference', () => {
        const setPrefs = vi.fn();
        render(<HandsFreeOn setPrefs={setPrefs}><VoiceControl onSend={vi.fn()} sttLang="en-US" /></HandsFreeOn>);
        const toggle = screen.getByTestId('hands-free-toggle');
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(toggle);
        expect(setPrefs).toHaveBeenCalledWith({ handsFreeConversation: false });
    });

    it('debrief: a pause sends, the discussant is not watched or interrupted, the mic reopens after the reply', async () => {
        let replyDone;
        const onSend = vi.fn(() => new Promise((resolve) => { replyDone = resolve; }));
        const view = render(<HandsFreeOn><VoiceControl onSend={onSend} sttLang="it-IT" /></HandsFreeOn>);
        expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'idle');
        fireEvent.click(screen.getByRole('button', { name: /start listening/i }));
        expect(listens).toHaveLength(1);
        expect(listens[0].lang).toBe('it-IT');

        act(() => listens[0].onResult({ final: '', interim: 'penso sia un infarto' }));
        act(() => { vi.advanceTimersByTime(PAUSE_MS); });
        expect(onSend).toHaveBeenCalledExactlyOnceWith('penso sia un infarto');

        view.rerender(<HandsFreeOn><VoiceControl onSend={onSend} sttLang="it-IT" busy speaking /></HandsFreeOn>);
        // No watcher: the discussant finishes its point.
        expect(listens).toHaveLength(1);
        expect(screen.getByTestId('hands-free-status')).toHaveTextContent(/discussant is speaking/i);
        expect(screen.getByRole('button', { name: /start listening/i })).toBeDisabled();

        view.rerender(<HandsFreeOn><VoiceControl onSend={onSend} sttLang="it-IT" /></HandsFreeOn>);
        await act(async () => { replyDone(); });
        expect(listens).toHaveLength(2);
        expect(listens[1]).not.toHaveProperty('purpose');
    });

    it('Bedside room (onInterrupt): the reply is watched, and talking over the patient silences it', async () => {
        const onInterrupt = vi.fn();
        const onSend = vi.fn(() => new Promise(() => {}));
        const spoken = () => 'It hurts here when I breathe in.';
        const props = { onSend, sttLang: 'fi-FI', onInterrupt, getSpokenText: spoken, variant: 'room' };
        const view = render(<HandsFreeOn><VoiceControl {...props} /></HandsFreeOn>);
        fireEvent.click(screen.getByRole('button', { name: /start listening/i }));
        act(() => listens[0].onResult({ final: 'missä sattuu', interim: '' }));
        act(() => { vi.advanceTimersByTime(PAUSE_MS); });
        expect(onSend).toHaveBeenCalledTimes(1);

        view.rerender(<HandsFreeOn><VoiceControl {...props} busy speaking /></HandsFreeOn>);
        expect(listens).toHaveLength(2);
        expect(listens[1].purpose).toBe('watch');
        act(() => listens[1].onResult({ final: 'It hurts', interim: 'anteeksi tohtori' }));
        expect(onInterrupt).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'listening');
    });
});
