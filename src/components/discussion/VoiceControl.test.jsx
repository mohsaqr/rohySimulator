// Contract for VoiceControl — Rohy's one microphone control.
//
// It was written for the debrief screen; the 3D room now uses the SAME
// component so the two surfaces cannot drift into two mic implementations
// (and so the room inherits its seven translations for free). The first
// block below is CHARACTERIZATION: it pins the debrief behaviour exactly as
// it was before the room existed, so the additive props can never change it.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VoiceControl from './VoiceControl';

// The recogniser itself is Rohy's service; this component only drives it.
const listeners = {};
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
    startListening.mockClear();
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
